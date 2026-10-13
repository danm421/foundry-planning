import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import {
  requireActiveSubscriptionForFirm,
  requireOrgAdminOrOwner,
  ForbiddenError,
  authErrorResponse,
  nullOnAccessDenial,
} from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { updateClientProfileForClient } from "@/lib/clients/client-profile-writes";
import { softDeleteCrmHousehold } from "@/lib/crm/households";

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

// DELETE /api/clients/[id] — move the client's household to the Trash. The
// same lifecycle as deleting the household from the clients list: a firm admin
// only, restorable until the Trash purge permanently deletes it. Only the
// owning firm's own access qualifies; access through a share never does,
// whatever its permission.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const { id } = await params;
    const { client, firmId, access } = await requireClientAccess(id);
    if (access !== "own") {
      throw new ForbiddenError("Only the owning firm can delete this client");
    }
    await requireActiveSubscriptionForFirm(firmId);

    const { userId } = await auth();
    await softDeleteCrmHousehold(client.crmHouseholdId, userId ?? "system");

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
