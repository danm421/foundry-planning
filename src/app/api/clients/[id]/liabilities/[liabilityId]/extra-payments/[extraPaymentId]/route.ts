import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { toExtraPaymentSnapshot, EXTRA_PAYMENT_FIELD_LABELS } from "@/lib/audit/snapshots/extra-payment";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; liabilityId: string; extraPaymentId: string }>;
};

async function verifyOwnership(clientId: string, liabilityId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return false;

  const [liab] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
  return !!liab;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id, liabilityId, extraPaymentId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, liabilityId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();

    // Strip identity / ownership fields so an attacker can't reparent an
    // extra-payment row to a different liability or rewrite its id via
    // request body. Same hardening pattern as clients/[id] PUT.
    const {
      id: _stripId,
      liabilityId: _stripLiabilityId,
      createdAt: _stripCreatedAt,
      updatedAt: _stripUpdatedAt,
      ...safeUpdate
    } = body;
    void _stripId; void _stripLiabilityId;
    void _stripCreatedAt; void _stripUpdatedAt;

    const [before] = await db
      .select()
      .from(extraPayments)
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      );

    if (!before) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(extraPayments)
      .set({ ...safeUpdate, updatedAt: new Date() })
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordUpdate({
      action: "extra_payment.update",
      resourceType: "extra_payment",
      resourceId: extraPaymentId,
      clientId: id,
      firmId,
      before: await toExtraPaymentSnapshot(before),
      after: await toExtraPaymentSnapshot(updated),
      fieldLabels: EXTRA_PAYMENT_FIELD_LABELS,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id, liabilityId, extraPaymentId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyOwnership(id, liabilityId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(extraPayments)
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      );

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snapshot = await toExtraPaymentSnapshot(existing);

    await db
      .delete(extraPayments)
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      );

    await recordDelete({
      action: "extra_payment.delete",
      resourceType: "extra_payment",
      resourceId: extraPaymentId,
      clientId: id,
      firmId,
      snapshot,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
