import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

// PUT /api/clients/[id]/accounts/[accountId] — update account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, accountId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();

    // Prevent mass-assignment: strip identity / tenancy fields so the row
     // can't be reparented or its id rewritten via request body.
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
      .update(accounts)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/accounts/[accountId] — delete account
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, accountId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Protect the default household cash account — it's required by the projection engine.
    const [target] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    if (target?.isDefaultChecking) {
      return NextResponse.json(
        { error: "The default household cash account cannot be deleted." },
        { status: 400 }
      );
    }

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/accounts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
