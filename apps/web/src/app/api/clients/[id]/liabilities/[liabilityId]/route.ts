import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

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

    // Prevent mass-assignment: strip identity / tenancy fields.
    const {
      id: _stripId,
      clientId: _stripClientId,
      createdAt: _stripCreatedAt,
      updatedAt: _stripUpdatedAt,
      ...safeUpdate
    } = body;
    void _stripId; void _stripClientId;
    void _stripCreatedAt; void _stripUpdatedAt;

    const [updated] = await db
      .update(liabilities)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
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

    await recordAudit({
      action: "liability.delete",
      resourceType: "liability",
      resourceId: liabilityId,
      clientId: id,
      firmId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
