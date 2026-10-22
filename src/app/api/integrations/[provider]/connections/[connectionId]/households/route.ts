import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationApiLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { connectionCallContext } from "@/lib/integrations/auth";
import {
  externalFirmIdOf,
  getLinksForConnection,
  listFirmLinksOutside,
} from "@/lib/integrations/households";
import {
  countConnectedAccounts,
  sortHouseholdRows,
  type HouseholdTableRow,
} from "@/lib/integrations/household-table";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { VISIBLE_ALL, hidesPrivateClient, resolveVisibleAdvisorIds } from "@/lib/visibility";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { resolveOwnedConnection } from "../_owned";

/**
 * GET — the connection's household table: every external household from one
 * groups call, with this connection's links and account counts, plus what
 * colleagues already hold through their own connections.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { provider, connection, firmId, userId } = owned;
    const { orgRole } = await auth();

    // Per connection, so one advisor's browsing can't 429 a colleague.
    const rl = await checkIntegrationApiLimit(`${provider.id}:${connection.id}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} requests. Please try again shortly.`);
    }

    const [households, links, outside, visible] = await Promise.all([
      connectionCallContext(connection.id).then((ctx) => provider.client.getHouseholds(ctx)),
      getLinksForConnection(connection.id),
      listFirmLinksOutside({ firmId, connectionId: connection.id }),
      resolveVisibleAdvisorIds(userId, orgRole, firmId),
    ]);
    const [counts, names] = await Promise.all([
      countConnectedAccounts({ providerId: provider.id, links }),
      resolveActors([...new Set(outside.map((l) => l.linkedByUserId).filter((v): v is string => !!v))]),
    ]);
    const linkerName = (id: string | null) => (id ? names.get(id)?.name : undefined) ?? "another advisor";

    const linkByHousehold = new Map(links.map((l) => [l.externalHouseholdId, l]));
    // A household is held elsewhere only on the same provider and under the
    // same Addepar firm: the household unique index treats two providers', or
    // two Addepar firms', ids as distinct.
    const ownFirm = externalFirmIdOf(connection) ?? "";
    const lockedByHousehold = new Map(
      outside
        .filter((l) => l.providerId === provider.id && (l.externalFirmId ?? "") === ownFirm)
        .map((l) => [l.externalHouseholdId, linkerName(l.linkedByUserId)]),
    );

    const rows: HouseholdTableRow[] = households.map((h) => {
      const link = linkByHousehold.get(h.id);
      return {
        id: h.id,
        name: h.name,
        link: link ? { linkId: link.id, clientId: link.clientId } : null,
        lockedBy: lockedByHousehold.get(h.id) ?? null,
        accounts: link ? (counts.get(link.id) ?? null) : null,
      };
    });
    // A client has one link, so any client linked through another connection
    // can't be linked here, whatever its provider or Addepar firm. Only the
    // clients the caller may see are named (the book and Private client
    // rules); the picker lists no others, so any more would only leak them.
    const maySee = (l: (typeof outside)[number]) =>
      (visible === VISIBLE_ALL || visible.has(l.advisorId)) && !hidesPrivateClient({ userId, orgRole }, l);
    const takenClients = Object.fromEntries(
      outside.filter(maySee).map((l) => [l.clientId, linkerName(l.linkedByUserId)]),
    );

    return NextResponse.json({ households: sortHouseholdRows(rows), takenClients });
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.json({ error: `${err.providerId} is not yet configured` }, { status: 503 });
    }
    console.error("GET /api/integrations/[provider]/connections/[connectionId]/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
