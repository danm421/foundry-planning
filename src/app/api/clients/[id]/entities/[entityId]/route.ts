import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entities, accounts, accountOwners } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { updateEntityForClient, verifyEntity } from "@/lib/clients/entities-writes";
import { assertEntitiesInClient } from "@/lib/db-scoping";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const { id, entityId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    if (!(await verifyEntity(entityId, id))) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const result = await updateEntityForClient({
      clientId: id,
      firmId,
      entityId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  try {
    const { id, entityId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // The cleanup below keys on the bare id, so prove it is this client's first.
    const owned = await assertEntitiesInClient(id, [entityId]);
    if (!owned.ok) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Delete the entity's default checking accounts explicitly. The accounts.owner_entity_id
    // FK is ON DELETE SET NULL, so other entity-owned accounts simply become household-
    // owned once the entity is gone — but a default checking whose owner_entity_id goes
    // Delete the entity's default checking account (if any). Previously keyed by
    // ownerEntityId; now find via account_owners junction table.
    // null would collide with the household's own default checking on the per-scenario
    // unique index.
    await db.transaction(async (tx) => {
      const entityDefaultCheckingOwnerRows = await tx
        .select({ accountId: accountOwners.accountId })
        .from(accountOwners)
        .where(eq(accountOwners.entityId, entityId));
      const entityAccountIds = entityDefaultCheckingOwnerRows.map((r) => r.accountId);
      if (entityAccountIds.length > 0) {
        await tx
          .delete(accounts)
          .where(
            and(
              eq(accounts.clientId, id),
              inArray(accounts.id, entityAccountIds),
              eq(accounts.isDefaultChecking, true)
            )
          );
      }

      // Remove will-recipient rows that point at this entity before deleting it —
      // recipient_id is a polymorphic FK-less column, so a plain delete would
      // leave a dangling id and silently wrong estate projections (audit F13).
      await cleanupWillRecipientReferences(tx, "entity", entityId);
      await pruneOrphanScenarioChanges(tx, entityId, id);

      await tx
        .delete(entities)
        .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));
    });

    await recordAudit({
      action: "entity.delete",
      resourceType: "entity",
      resourceId: entityId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/entities/[entityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
