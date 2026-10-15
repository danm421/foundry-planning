import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { annuityContracts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { findAnnuityAccount, serializeContract, upsertAnnuityContractForClient } from "@/lib/clients/annuity-contracts-writes";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/annuity-contracts/[accountId]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    await requireOrgId();
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const target = await findAnnuityAccount(id, accountId);
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const [row] = await db
      .select()
      .from(annuityContracts)
      .where(eq(annuityContracts.accountId, accountId));
    return NextResponse.json(row ? serializeContract(row) : null);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/annuity-contracts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/annuity-contracts/[accountId]
// Upsert of a 1:1 extension row keyed by accountId.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await findAnnuityAccount(id, accountId))) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await upsertAnnuityContractForClient({
      clientId: id,
      firmId,
      accountId,
      input,
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json({ ok: true, warnings: result.data.warnings })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/annuity-contracts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
