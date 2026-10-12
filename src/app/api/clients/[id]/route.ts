import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, plaidItems, intakeForms } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { recordDelete } from "@/lib/audit";
import { toClientSnapshot } from "@/lib/audit/snapshots/client";
import { requireClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse, nullOnAccessDenial } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { updateClientProfileForClient } from "@/lib/clients/client-profile-writes";
import { revokePlaidTokens } from "@/lib/plaid/revoke";

export const dynamic = "force-dynamic";

// GET /api/clients/[id] — get single client
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Only an access *denial* degrades to null → 404; a DB fault propagates to
    // the catch below and answers 500 rather than a misleading "Not found".
    const access = await requireClientAccess(id).catch(nullOnAccessDenial);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { client } = access;

    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id] — update client. Identity now lives on CRM contacts;
// this endpoint accepts identity fields (firstName/lastName/dateOfBirth/email/
// address + spouse*) and mirrors them onto the linked CRM household contacts,
// then writes the planning-only fields onto the clients row.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const result = await updateClientProfileForClient({
      clientId: id,
      firmId,
      body: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id] — delete client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { client: existing, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const snapshot = toClientSnapshot(existing);

    // Plaid access tokens, collected BEFORE the cascade drops plaid_items —
    // afterwards the encrypted tokens are gone and the vendor-side connection
    // can never be severed (audit F3).
    const plaidTokenRows = await db
      .select({ accessToken: plaidItems.accessToken })
      .from(plaidItems)
      .where(eq(plaidItems.clientId, id));

    // intake_forms.client_id is ON DELETE SET NULL; erase the client's forms
    // explicitly so their answers and public links don't outlive the client.
    await db.transaction(async (tx) => {
      await tx
        .delete(intakeForms)
        .where(and(eq(intakeForms.clientId, id), eq(intakeForms.firmId, firmId)));
      await tx
        .delete(clients)
        .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    });

    await revokePlaidTokens(
      plaidTokenRows.map((r) => r.accessToken),
      `client-delete ${id}`,
    );

    await recordDelete({
      action: "client.delete",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      snapshot,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
