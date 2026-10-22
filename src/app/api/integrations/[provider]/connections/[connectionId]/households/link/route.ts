import { NextResponse } from "next/server";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import {
  getHouseholdLinkForClient,
  linkHouseholdOnConnection,
  unlinkHousehold,
} from "@/lib/integrations/households";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { recordAudit } from "@/lib/audit";
import { resolveOwnedConnection } from "../../_owned";

type Params = { params: Promise<{ provider: string; connectionId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

const REFUSED = {
  client_linked_elsewhere: "This client is already linked through another connection.",
  household_linked_elsewhere: "This household is already linked to another client.",
} as const;

/** POST — link a client to a household through the caller's own connection. */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return notFound();
    const { provider, connection, firmId, userId } = owned;

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const externalHouseholdId =
      typeof body?.externalHouseholdId === "string" ? body.externalHouseholdId : null;
    if (!clientId || !externalHouseholdId) {
      return NextResponse.json({ error: "clientId and externalHouseholdId are required" }, { status: 400 });
    }

    // Gated on the POST only. DELETE (unlink) stays reachable on a lapsed
    // subscription: severing a provider's hold on a client must never be the
    // thing billing blocks.
    await requireActiveSubscriptionForFirm(firmId);

    // Throws ForbiddenError for a client the caller can't edit (or that isn't
    // in this firm). A cross-firm edit share grants PLAN editing, not the
    // right to feed the plan from this firm's provider.
    const access = await requireClientEditAccess(clientId);
    if (access.access !== "own") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const outcome = await linkHouseholdOnConnection({ connection, clientId, externalHouseholdId, userId });
    if (!outcome.ok) {
      const linker = outcome.linkedByUserId;
      const linkedByName = linker ? ((await resolveActors([linker])).get(linker)?.name ?? null) : null;
      return NextResponse.json({ error: REFUSED[outcome.reason], linkedByName }, { status: 409 });
    }

    await recordAudit({
      action: "integration.household.link",
      resourceType: "integration_household_link",
      resourceId: externalHouseholdId,
      clientId,
      firmId,
      metadata: { provider: provider.id, externalHouseholdId, connectionId: connection.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connections/[connectionId]/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE — unlink a client. Only the owner of the connection the client is
 * linked through may, so this checks the link's connection, not client edit
 * access.
 */
export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  try {
    const owned = await resolveOwnedConnection(params);
    if (!owned) return notFound();
    const { connection, firmId } = owned;

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    // Read the link BEFORE deleting it: it's what proves the client is linked
    // through this connection, and the only place the true provider and
    // external household id live for the audit row.
    const link = await getHouseholdLinkForClient(clientId);
    if (!link || link.connectionId !== connection.id) return notFound();

    await unlinkHousehold(connection.id, clientId);
    await recordAudit({
      action: "integration.household.unlink",
      resourceType: "integration_household_link",
      resourceId: link.externalHouseholdId,
      clientId,
      firmId,
      metadata: {
        provider: link.provider,
        externalHouseholdId: link.externalHouseholdId,
        connectionId: connection.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "DELETE /api/integrations/[provider]/connections/[connectionId]/households/link error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
