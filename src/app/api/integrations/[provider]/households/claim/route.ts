// Advisor-facing household linking. Unlike the admin's link-from-the-table
// flow, the caller here has NO browsable list — they must already know the
// household id. Every guard below exists to keep that id from becoming
// guessable in practice; see the design doc's "Decision" section.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkIntegrationClaimLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { makeCallContext } from "@/lib/integrations/auth";
import { claimHousehold } from "@/lib/integrations/households";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { recordAudit } from "@/lib/audit";
import { resolveProvider } from "../../_provider";

/**
 * ONE message for every outcome that could reveal whether an id names a real
 * household in this firm — unknown id, id held by another client, and a lost
 * race all return this. Distinguishing them would tell a caller which ids are
 * valid, which is the exact fact the no-list design hides. The audit row keeps
 * the true reason for admins.
 */
const OPAQUE = "That household ID isn't available to link.";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider || !provider.syncs) return new Response("Not found", { status: 404 });

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const raw = typeof body?.externalHouseholdId === "string" ? body.externalHouseholdId.trim() : "";
    if (!clientId || !raw) {
      return NextResponse.json(
        { error: "clientId and externalHouseholdId are required" },
        { status: 400 },
      );
    }

    // Throws ForbiddenError for a non-owner, a view-only share, or an unknown
    // client — all mapped to 403 by authErrorResponse below.
    const access = await requireClientEditAccess(clientId);

    // A cross-firm edit share grants PLAN editing, not the right to spend the
    // owning firm's Addepar credentials or claim inside its book.
    if (access.access !== "own") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const firmId = access.firmId;

    const rl = await checkIntegrationClaimLimit(`${provider.id}:${userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many link attempts. Please try again later.");
    }

    const ctx = await makeCallContext(firmId, provider.id);
    const activeProvider = provider;
    const result = await claimHousehold({
      firmId,
      providerId: activeProvider.id,
      clientId,
      externalHouseholdId: raw,
      userId,
      listHouseholds: () => activeProvider.client.getHouseholds(ctx),
    });

    // A failed claim's clientId is deliberately NULLED here: the per-client
    // audit read surfaces (the activity feed and the client overview) filter
    // on `clientId` and are reachable with only READ access to the client —
    // weaker than the edit access this route requires. Leaving clientId set
    // on a failure would let an advisor probe a neighbouring household id,
    // receive the opaque 409, then recover the TRUE reason via their own
    // client's activity feed — defeating the point of OPAQUE above. A
    // successful claim keeps clientId: the advisor already has the outcome
    // from the 200 response, and it is genuine client history. Either way
    // the attempted client id rides in metadata for the admin audit query.
    await recordAudit({
      action: "integration.household.claim",
      resourceType: "integration_household_link",
      resourceId: raw,
      clientId: result.ok ? clientId : null,
      firmId,
      metadata: {
        provider: activeProvider.id,
        outcome: result.ok ? "ok" : result.reason,
        attemptedClientId: clientId,
      },
    });

    if (!result.ok) return NextResponse.json({ error: OPAQUE }, { status: 409 });
    return NextResponse.json({ ok: true, name: result.name });
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.json({ error: `${err.providerId} is not yet configured` }, { status: 503 });
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/households/claim error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
