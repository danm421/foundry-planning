import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, entityOwners, accounts, accountOwners, familyMembers } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
import type { TrustSubType } from "@/lib/entities/trust";

function deriveLegacyOwner(
  ownersInput: { familyMemberId: string; percent: number }[] | undefined,
  members: { id: string; role: "client" | "spouse" | "child" | "other" }[],
): "client" | "spouse" | "joint" | null {
  if (!ownersInput || ownersInput.length === 0) return null;
  const clientId = members.find((m) => m.role === "client")?.id;
  const spouseId = members.find((m) => m.role === "spouse")?.id;
  const total = ownersInput.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 0.0001) return null;
  if (ownersInput.length === 1) {
    const o = ownersInput[0];
    if (o.familyMemberId === clientId) return "client";
    if (o.familyMemberId === spouseId) return "spouse";
  }
  if (ownersInput.length === 2 && clientId && spouseId) {
    const c = ownersInput.find((o) => o.familyMemberId === clientId);
    const s = ownersInput.find((o) => o.familyMemberId === spouseId);
    if (c && s && Math.abs(c.percent - 0.5) < 0.0001 && Math.abs(s.percent - 0.5) < 0.0001) {
      return "joint";
    }
  }
  return null;
}

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
      accessibleToClient?: boolean;
      isGrantor?: boolean;
      value?: string | number;
      basis?: string | number;
      owner?: "client" | "spouse" | "joint" | null;
      owners?: { familyMemberId: string; percent: number }[];
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

    const householdMembers = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));

    if (patch.owners) {
      const memberIds = new Set(householdMembers.map((m) => m.id));
      for (const o of patch.owners) {
        if (!memberIds.has(o.familyMemberId)) {
          return NextResponse.json(
            { error: `owners.familyMemberId ${o.familyMemberId} does not belong to this client` },
            { status: 400 },
          );
        }
      }
      if (patch.owners.length > 0) {
        const total = patch.owners.reduce((s, o) => s + o.percent, 0);
        if (Math.abs(total - 1) > 0.0001) {
          return NextResponse.json({ error: "owners percent must sum to 1.0" }, { status: 400 });
        }
      }
    }

    const effectiveType = patch.entityType ?? existing.entityType;
    const isBusinessType = !["trust", "foundation"].includes(effectiveType);
    const ownerEnumFromOwners =
      patch.owners !== undefined && isBusinessType
        ? deriveLegacyOwner(patch.owners, householdMembers)
        : undefined;

    const merged = {
      name: patch.name ?? existing.name,
      entityType: patch.entityType ?? existing.entityType,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      includeInPortfolio: patch.includeInPortfolio ?? existing.includeInPortfolio,
      accessibleToClient: patch.accessibleToClient ?? existing.accessibleToClient,
      isGrantor: patch.isGrantor ?? existing.isGrantor,
      value: patch.value ?? existing.value,
      basis: patch.basis ?? existing.basis,
      owner:
        ownerEnumFromOwners !== undefined
          ? ownerEnumFromOwners
          : patch.owner !== undefined
            ? patch.owner
            : existing.owner,
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
        ...(patch.accessibleToClient !== undefined && {
          accessibleToClient: Boolean(patch.accessibleToClient),
        }),
        ...(patch.isGrantor !== undefined && {
          isGrantor: Boolean(patch.isGrantor),
        }),
        ...(patch.value !== undefined && { value: String(patch.value) }),
        ...(patch.basis !== undefined && { basis: String(patch.basis) }),
        ...(ownerEnumFromOwners !== undefined
          ? { owner: ownerEnumFromOwners }
          : patch.owner !== undefined
            ? { owner: patch.owner ?? null }
            : {}),
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

    // If owners were provided, replace the entity_owners set wholesale.
    // Skip for trust/foundation types — those don't use entity_owners.
    if (patch.owners !== undefined && isBusinessType) {
      await db.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
      if (patch.owners.length > 0) {
        await db.insert(entityOwners).values(
          patch.owners.map((o) => ({
            entityId,
            familyMemberId: o.familyMemberId,
            percent: String(o.percent),
          })),
        );
      }
    }

    // Type switched away from a business kind → clear any owner rows.
    if (
      patch.entityType !== undefined &&
      !isBusinessType &&
      ["llc", "s_corp", "c_corp", "partnership", "other"].includes(existing.entityType)
    ) {
      await db.delete(entityOwners).where(eq(entityOwners.entityId, entityId));
    }

    await recordAudit({
      action: "entity.update",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
      metadata: { name: updated.name, entityType: updated.entityType },
    });

    const ownerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, entityId));
    const responseOwners = ownerRows.map((o) => ({
      kind: "family_member" as const,
      familyMemberId: o.familyMemberId,
      percent: parseFloat(o.percent),
    }));
    return NextResponse.json({ ...updated, owners: responseOwners });
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
