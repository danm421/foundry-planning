import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

// PUT /api/clients/[id]/liabilities/[liabilityId] — update liability
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();

    const [updated] = await db
      .update(liabilities)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Liability not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/liabilities/[liabilityId] — delete liability
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(liabilities)
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
