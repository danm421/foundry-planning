import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId, requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
import type { TrustSubType } from "@/lib/entities/trust";

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
    const firmId = await requireOrgId();
    const { id, entityId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));
    if (!existing) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = entityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const patch = parsed.data as {
      name?: string;
      entityType?: typeof existing.entityType;
      notes?: string | null;
      includeInPortfolio?: boolean;
      isGrantor?: boolean;
      value?: string | number;
      owner?: "client" | "spouse" | "joint" | null;
      grantors?: Array<{ name: string; pct: number }> | null;
      beneficiaries?: Array<{ name: string; pct: number }> | null;
      trustSubType?: string;
      isIrrevocable?: boolean;
      trustee?: string | null;
      exemptionConsumed?: number;
    };

    const merged = {
      name: patch.name ?? existing.name,
      entityType: patch.entityType ?? existing.entityType,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      includeInPortfolio: patch.includeInPortfolio ?? existing.includeInPortfolio,
      isGrantor: patch.isGrantor ?? existing.isGrantor,
      value: patch.value ?? existing.value,
      owner: patch.owner !== undefined ? patch.owner : existing.owner,
      grantors: patch.grantors !== undefined ? patch.grantors : existing.grantors,
      beneficiaries:
        patch.beneficiaries !== undefined ? patch.beneficiaries : existing.beneficiaries,
      trustSubType:
        patch.trustSubType !== undefined
          ? patch.trustSubType
          : existing.trustSubType ?? undefined,
      isIrrevocable:
        patch.isIrrevocable !== undefined
          ? patch.isIrrevocable
          : existing.isIrrevocable ?? undefined,
      trustee: patch.trustee !== undefined ? patch.trustee : existing.trustee,
      exemptionConsumed:
        patch.exemptionConsumed !== undefined
          ? patch.exemptionConsumed
          : Number(existing.exemptionConsumed ?? 0),
    };

    const mergedCheck = entityCreateSchema.safeParse(merged);
    if (!mergedCheck.success) {
      return NextResponse.json(
        { error: "Resulting entity would be invalid", issues: mergedCheck.error.issues },
        { status: 400 },
      );
    }

    const typeSwitchedAwayFromTrust =
      patch.entityType !== undefined &&
      patch.entityType !== "trust" &&
      existing.entityType === "trust";

    const [updated] = await db
      .update(entities)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.entityType !== undefined && { entityType: patch.entityType }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.includeInPortfolio !== undefined && {
          includeInPortfolio: Boolean(patch.includeInPortfolio),
        }),
        ...(patch.isGrantor !== undefined && {
          isGrantor: Boolean(patch.isGrantor),
        }),
        ...(patch.value !== undefined && { value: String(patch.value) }),
        ...(patch.owner !== undefined && { owner: patch.owner ?? null }),
        ...(patch.grantors !== undefined && { grantors: patch.grantors ?? null }),
        ...(patch.beneficiaries !== undefined && {
          beneficiaries: patch.beneficiaries ?? null,
        }),
        ...(patch.trustSubType !== undefined && {
          trustSubType: patch.trustSubType as TrustSubType,
        }),
        ...(patch.isIrrevocable !== undefined && {
          isIrrevocable: patch.isIrrevocable,
        }),
        ...(patch.trustee !== undefined && { trustee: patch.trustee ?? null }),
        ...(patch.exemptionConsumed !== undefined && {
          exemptionConsumed: String(patch.exemptionConsumed),
        }),
        ...(typeSwitchedAwayFromTrust && {
          trustSubType: null,
          isIrrevocable: null,
          trustee: null,
          exemptionConsumed: "0",
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    await recordAudit({
      action: "entity.update",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
      metadata: { name: updated.name, entityType: updated.entityType },
    });

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
    const firmId = await requireOrgId();
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

    await recordAudit({
      action: "entity.delete",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
