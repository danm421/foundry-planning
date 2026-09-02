import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { findClientInFirm } from "@/lib/db-scoping";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { linkHousehold, unlinkHousehold, getHouseholdLinkForClient } from "@/lib/integrations/households";
import { recordAudit } from "@/lib/audit";
import { resolveProvider } from "../../_provider";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const externalHouseholdId =
      typeof body?.externalHouseholdId === "string" ? body.externalHouseholdId : null;
    if (!clientId || !externalHouseholdId) {
      return NextResponse.json({ error: "clientId and externalHouseholdId are required" }, { status: 400 });
    }

    const client = await findClientInFirm(clientId, firmId);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    await linkHousehold({ firmId, providerId: provider.id, clientId, externalHouseholdId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    // Unlinking is a per-client action: the client's own advisor may do it, and
    // an admin still qualifies through the same check. Replaces the former
    // admin-only gate + findClientInFirm lookup, which this subsumes.
    const access = await requireClientEditAccess(clientId);
    if (access.access !== "own") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const firmId = access.firmId;

    // Read the link row BEFORE deleting it — unlinkHousehold's delete is
    // provider-blind (no provider filter, and both link paths key on clientId
    // alone, so a client has exactly one row whatever its provider), and the
    // row is the only place the true provider and external household id live.
    // Reading the URL's `provider.id` instead would mislabel a household
    // unlinked from a DIFFERENT provider's route, and the external id would be
    // unrecoverable once the row is gone — leaving this audit row unable to
    // pair with the claim row that created it.
    const link = await getHouseholdLinkForClient(clientId);
    await unlinkHousehold(firmId, clientId);
    await recordAudit({
      action: "integration.household.unlink",
      resourceType: "integration_household_link",
      // Falls back to clientId only when there was no link row to begin with
      // (a no-op unlink attempt) — recordAudit requires a non-null resourceId.
      resourceId: link?.externalHouseholdId ?? clientId,
      clientId,
      firmId,
      metadata: {
        provider: link?.provider ?? provider.id,
        externalHouseholdId: link?.externalHouseholdId ?? null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("DELETE /api/integrations/[provider]/households/link error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
