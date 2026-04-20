import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; liabilityId: string; extraPaymentId: string }>;
};

async function verifyOwnership(clientId: string, liabilityId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [liab] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
  return !!liab;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { id, liabilityId, extraPaymentId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
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

    await recordAudit({
      action: "extra_payment.update",
      resourceType: "extra_payment",
      resourceId: extraPaymentId,
      clientId: id,
      firmId,
      metadata: { liabilityId, year: updated.year, type: updated.type },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { id, liabilityId, extraPaymentId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(extraPayments)
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      );

    await recordAudit({
      action: "extra_payment.delete",
      resourceType: "extra_payment",
      resourceId: extraPaymentId,
      clientId: id,
      firmId,
      metadata: { liabilityId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
