import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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
    const firmId = await getOrgId();
    const { id, liabilityId, extraPaymentId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();

    const [updated] = await db
      .update(extraPayments)
      .set({ ...body, updatedAt: new Date() })
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
    const firmId = await getOrgId();
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

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
