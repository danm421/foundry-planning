import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, entities, accounts } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      entityType,
      notes,
      includeInPortfolio,
      isGrantor,
      value,
      owner,
      grantors,
      beneficiaries,
    } = body;

    const [updated] = await db
      .update(entities)
      .set({
        ...(name !== undefined && { name }),
        ...(entityType !== undefined && { entityType }),
        ...(notes !== undefined && { notes }),
        ...(includeInPortfolio !== undefined && { includeInPortfolio: Boolean(includeInPortfolio) }),
        ...(isGrantor !== undefined && { isGrantor: Boolean(isGrantor) }),
        ...(value !== undefined && { value: String(value) }),
        ...(owner !== undefined && { owner: owner ?? null }),
        ...(grantors !== undefined && { grantors }),
        ...(beneficiaries !== undefined && { beneficiaries }),
        updatedAt: new Date(),
      })
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Delete the entity's default checking accounts explicitly. The accounts.owner_entity_id
    // FK is ON DELETE SET NULL, so other entity-owned accounts simply become household-
    // owned once the entity is gone — but a default checking whose owner_entity_id goes
    // null would collide with the household's own default checking on the per-scenario
    // unique index.
    await db
      .delete(accounts)
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.ownerEntityId, entityId),
          eq(accounts.isDefaultChecking, true)
        )
      );

    await db
      .delete(entities)
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
