import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordCreate } from "@/lib/audit";
import { toExtraPaymentSnapshot } from "@/lib/audit/snapshots/extra-payment";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; liabilityId: string }> };

async function verifyOwnership(clientId: string, liabilityId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [liab] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
  return !!liab;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id, liabilityId } = await params;

    if (!(await verifyOwnership(id, liabilityId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(extraPayments)
      .where(eq(extraPayments.liabilityId, liabilityId));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET extra-payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id, liabilityId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await verifyOwnership(id, liabilityId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const { year, type, amount } = body;

    if (year == null || !type || amount == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [row] = await db
      .insert(extraPayments)
      .values({
        liabilityId,
        year: Number(year),
        type,
        amount: String(amount),
      })
      .returning();

    await recordCreate({
      action: "extra_payment.create",
      resourceType: "extra_payment",
      resourceId: row.id,
      clientId: id,
      firmId,
      snapshot: await toExtraPaymentSnapshot(row),
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST extra-payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
