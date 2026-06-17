import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  gifts,
  entities,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { giftUpdateSchema } from "@/lib/schemas/gifts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, giftId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = giftUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const patch = parsed.data as {
      year?: number;
      amount?: number;
      percent?: number | null;
      grantor?: "client" | "spouse" | "joint";
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
      useCrummeyPowers?: boolean;
      notes?: string | null;
    };

    if (patch.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, patch.recipientEntityId),
            eq(entities.clientId, id),
          ),
        );
      if (!entity) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (entity.entityType !== "trust") {
        return NextResponse.json(
          { error: "Recipient must be a trust" },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          { error: "Gifts to revocable trusts are not completed gifts" },
          { status: 400 },
        );
      }
    }
    if (patch.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, patch.recipientFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Recipient family member not found for this client" },
          { status: 400 },
        );
      }
    }
    if (patch.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, patch.recipientExternalBeneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        );
      if (!ext) {
        return NextResponse.json(
          { error: "Recipient external beneficiary not found for this client" },
          { status: 400 },
        );
      }
    }

    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(gifts)
        .set({
          ...(patch.year !== undefined && { year: patch.year }),
          ...(patch.amount !== undefined && { amount: String(patch.amount) }),
          ...(patch.percent !== undefined && {
            percent: patch.percent != null ? String(patch.percent) : null,
          }),
          ...(patch.grantor !== undefined && { grantor: patch.grantor }),
          ...(patch.recipientEntityId !== undefined && {
            recipientEntityId: patch.recipientEntityId ?? null,
          }),
          ...(patch.recipientFamilyMemberId !== undefined && {
            recipientFamilyMemberId: patch.recipientFamilyMemberId ?? null,
          }),
          ...(patch.recipientExternalBeneficiaryId !== undefined && {
            recipientExternalBeneficiaryId:
              patch.recipientExternalBeneficiaryId ?? null,
          }),
          ...(patch.useCrummeyPowers !== undefined && {
            useCrummeyPowers: patch.useCrummeyPowers,
          }),
          ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
          updatedAt: new Date(),
        })
        .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
        .returning();

      if (!updated) return undefined;

      // If percent was updated and this is a parent gift (no parentGiftId),
      // propagate the new percent to all bundled child gifts.
      if (patch.percent !== undefined && updated.parentGiftId === null) {
        await tx
          .update(gifts)
          .set({
            percent: patch.percent != null ? String(patch.percent) : null,
            updatedAt: new Date(),
          })
          .where(eq(gifts.parentGiftId, giftId));
      }

      return updated;
    });

    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    await recordAudit({
      action: "gift.update",
      resourceType: "gift",
      resourceId: giftId,
      clientId: id,
      firmId,
    });
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, giftId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    let row: typeof gifts.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(gifts)
        .where(and(eq(gifts.id, giftId), eq(gifts.clientId, id)))
        .returning();
      row = deleted;
      if (deleted) {
        await pruneOrphanScenarioChanges(tx, giftId);
      }
    });
    if (!row) {
      return NextResponse.json({ error: "Gift not found" }, { status: 404 });
    }
    await recordAudit({
      action: "gift.delete",
      resourceType: "gift",
      resourceId: giftId,
      clientId: id,
      firmId,
      metadata: { year: row.year, grantor: row.grantor },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/gifts/[giftId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
