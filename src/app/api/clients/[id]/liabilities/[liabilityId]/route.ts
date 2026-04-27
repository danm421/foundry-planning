import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities, liabilityOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { toLiabilitySnapshot, LIABILITY_FIELD_LABELS } from "@/lib/audit/snapshots/liability";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
} from "@/lib/ownership";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/liabilities/[liabilityId] — update liability
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const firmId = await requireOrgId();
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

    const [before] = await db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Liability not found" }, { status: 404 });
    }

    // ── owners[] validation (PUT) ──────────────────────────────────────────
    let validatedOwners: ValidatedOwner[] | undefined;

    if (Array.isArray(body.owners)) {
      const shapeResult = validateOwnersShape(body.owners);
      if ("error" in shapeResult) {
        return NextResponse.json({ error: shapeResult.error }, { status: 400 });
      }
      const tenantError = await validateOwnersTenant(shapeResult.owners, id);
      if (tenantError) {
        return NextResponse.json({ error: tenantError.error }, { status: 400 });
      }
      validatedOwners = shapeResult.owners;
    }
    // ── end owners[] validation ────────────────────────────────────────────

    // Strip owners from the update payload — owners live in liability_owners, not liabilities
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { owners: _stripOwners, ...liabilityUpdate } = safeUpdate as Record<string, unknown>;

    let updated: typeof liabilities.$inferSelect;
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(liabilities)
        .set({
          ...liabilityUpdate,
          updatedAt: new Date(),
        })
        .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)))
        .returning();
      updated = result;

      if (validatedOwners) {
        await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));
        for (const o of validatedOwners) {
          await tx.insert(liabilityOwners).values({
            liabilityId,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    if (!updated!) {
      return NextResponse.json({ error: "Liability not found" }, { status: 404 });
    }

    await recordUpdate({
      action: "liability.update",
      resourceType: "liability",
      resourceId: liabilityId,
      clientId: id,
      firmId,
      before: await toLiabilitySnapshot(before),
      after: await toLiabilitySnapshot(updated!),
      fieldLabels: LIABILITY_FIELD_LABELS,
    });

    return NextResponse.json(updated!);
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
    const firmId = await requireOrgId();
    const { id, liabilityId } = await params;

    // Verify client belongs to this firm
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)));

    if (!existing) {
      return NextResponse.json({ error: "Liability not found" }, { status: 404 });
    }

    const snapshot = await toLiabilitySnapshot(existing);

    await db
      .delete(liabilities)
      .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, id)));

    await recordDelete({
      action: "liability.delete",
      resourceType: "liability",
      resourceId: liabilityId,
      clientId: id,
      firmId,
      snapshot,
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
