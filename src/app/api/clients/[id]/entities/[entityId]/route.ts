import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, accounts, accountOwners } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
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
      grantor?: "client" | "spouse" | null;
      beneficiaries?: Array<{ name: string; pct: number }> | null;
      trustSubType?: string;
      isIrrevocable?: boolean;
      trustee?: string | null;
      trustEnds?: "client_death" | "spouse_death" | "survivorship" | null;
      distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null;
      distributionAmount?: number | null;
      distributionPercent?: number | null;
    };

    const merged = {
      name: patch.name ?? existing.name,
      entityType: patch.entityType ?? existing.entityType,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      includeInPortfolio: patch.includeInPortfolio ?? existing.includeInPortfolio,
      isGrantor: patch.isGrantor ?? existing.isGrantor,
      value: patch.value ?? existing.value,
      owner: patch.owner !== undefined ? patch.owner : existing.owner,
      grantor: patch.grantor !== undefined ? patch.grantor : existing.grantor,
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
      trustEnds: patch.trustEnds !== undefined ? patch.trustEnds : existing.trustEnds,
      distributionMode:
        patch.distributionMode !== undefined
          ? patch.distributionMode
          : existing.distributionMode,
      distributionAmount:
        patch.distributionAmount !== undefined
          ? patch.distributionAmount
          : existing.distributionAmount != null
            ? Number(existing.distributionAmount)
            : null,
      distributionPercent:
        patch.distributionPercent !== undefined
          ? patch.distributionPercent
          : existing.distributionPercent != null
            ? Number(existing.distributionPercent)
            : null,
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
        ...(patch.grantor !== undefined && { grantor: patch.grantor ?? null }),
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
        ...(patch.trustEnds !== undefined && { trustEnds: patch.trustEnds ?? null }),
        ...(patch.distributionMode !== undefined && {
          distributionMode: patch.distributionMode,
        }),
        ...(patch.distributionAmount !== undefined && {
          distributionAmount:
            patch.distributionAmount != null
              ? String(patch.distributionAmount)
              : null,
        }),
        ...(patch.distributionPercent !== undefined && {
          distributionPercent:
            patch.distributionPercent != null
              ? String(patch.distributionPercent)
              : null,
        }),
        ...(typeSwitchedAwayFromTrust && {
          trustSubType: null,
          isIrrevocable: null,
          trustee: null,
          trustEnds: null,
          distributionMode: null,
          distributionAmount: null,
          distributionPercent: null,
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
    // Delete the entity's default checking account (if any). Previously keyed by
    // ownerEntityId; now find via account_owners junction table.
    // null would collide with the household's own default checking on the per-scenario
    // unique index.
    const entityDefaultCheckingOwnerRows = await db
      .select({ accountId: accountOwners.accountId })
      .from(accountOwners)
      .where(eq(accountOwners.entityId, entityId));
    const entityAccountIds = entityDefaultCheckingOwnerRows.map((r) => r.accountId);
    if (entityAccountIds.length > 0) {
      await db
        .delete(accounts)
        .where(
          and(
            eq(accounts.clientId, id),
            inArray(accounts.id, entityAccountIds),
            eq(accounts.isDefaultChecking, true)
          )
        );
    }

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
