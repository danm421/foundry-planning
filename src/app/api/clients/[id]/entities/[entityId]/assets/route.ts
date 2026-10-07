/**
 * POST /api/clients/[id]/entities/[entityId]/assets
 *
 * Assign / re-percent / remove an asset (account, liability, or business
 * entity) against a trust. `[entityId]` in the URL is the TRUST receiving
 * the asset.
 *
 * This is the entry point for the balance-sheet "add an asset to this trust"
 * flow. Body shape mirrors `AssetTabOp` from `src/components/forms/asset-tab-ops.ts`
 * so the same UI op can flow through here unchanged.
 *
 * Task 9 scope: only `{ op: "add", assetType: "entity" }` is implemented. The
 * other branches (`account`/`liability`, `remove`/`set-percent`) return 400
 * for now — they're wired by Tasks 11+ which either expand this route or
 * keep using the existing per-asset PUT endpoints.
 *
 * When the trust is IRREVOCABLE, an `add` is a GIFT: the route inserts a
 * §709-style gift row for every client/spouse the gift draws share from — one
 * row per grantor, with `business_entity_id`, `percent`, the gift `year` (the
 * body's, else the later of this calendar year and the base plan's start year),
 * and a denormalized `amount` snapshot
 * (= business.value × lostPct) so the report doesn't need to re-multiply.
 * The advisor's `valuation_discount` rides along as a fraction; `amount` stays
 * the FULL undiscounted value and the normalizer applies the discount to it.
 * A gift writes NO `entity_owners` rows — those are the authored baseline, and
 * the engine re-applies gifts on every read (see ./gift-writes). A `remove`
 * deletes the trust's gift rows (and the scenario changes aimed at them). Only a REVOCABLE trust's `add`, and a `remove`
 * of an authored trust row, retitle `entity_owners`.
 *
 * NOT IDEMPOTENT: calling POST twice with the same body gives the share twice
 * (inserts duplicate gift rows, or retitles twice). Callers (the balance-sheet
 * UI) rely on optimistic update + router.refresh to gate double-submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
// Body schema (and the shared valuationDiscount bound) live in lib/schemas so
// they can join the cross-surface bounds guard table.
import { assetOpSchema } from "@/lib/schemas/entity-assets";
import { db } from "@/db";
import {
  entities,
  entityOwners,
  familyMembers,
  gifts,
  planSettings,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import type { EntityOwner } from "@/engine/ownership";
import { planEntityGiftWrites } from "./gift-writes";

export const dynamic = "force-dynamic";

const BUSINESS_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { id: clientId, entityId: trustId } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json().catch(() => null);
    const parsed = assetOpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const op = parsed.data;

    // Account/liability mutations still live on the per-asset PUT endpoints
    // (handled directly in the trust form). This route only handles entity-
    // type ops (assigning / removing a business interest to a trust).
    if (op.assetType !== "entity") {
      return NextResponse.json(
        { error: `assetType="${op.assetType}" not yet implemented on this route` },
        { status: 400 },
      );
    }
    if (op.op === "set-percent") {
      return NextResponse.json(
        { error: `op="set-percent" not yet implemented for assetType="entity"` },
        { status: 400 },
      );
    }

    // Verify the trust (URL [entityId]) is a real trust in this client's data.
    const [trust] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, trustId), eq(entities.clientId, clientId)));
    if (!trust) {
      return NextResponse.json({ error: "Trust not found" }, { status: 404 });
    }
    if (trust.entityType !== "trust") {
      return NextResponse.json(
        { error: "Target entity is not a trust" },
        { status: 400 },
      );
    }

    // Verify the picked asset is a business entity in this client's data.
    const businessId = op.assetId;
    const [business] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, businessId), eq(entities.clientId, clientId)));
    if (!business) {
      return NextResponse.json(
        { error: "Business entity not found" },
        { status: 404 },
      );
    }
    if (!BUSINESS_TYPES.has(business.entityType)) {
      return NextResponse.json(
        { error: "Picked entity is not a business" },
        { status: 400 },
      );
    }

    // Load the authored owners, the household roster, and the business's
    // recorded gift rows — the plan resolves the household share through them.
    const ownerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, businessId));
    const householdMembers = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId));
    const businessGiftRows = await db
      .select({
        id: gifts.id,
        year: gifts.year,
        percent: gifts.percent,
        recipientEntityId: gifts.recipientEntityId,
        grantor: gifts.grantor,
      })
      .from(gifts)
      .where(and(eq(gifts.clientId, clientId), eq(gifts.businessEntityId, businessId)));

    const authoredOwners: EntityOwner[] = ownerRows.map((r) => {
      if (r.familyMemberId) {
        return {
          kind: "family_member" as const,
          familyMemberId: r.familyMemberId,
          percent: parseFloat(r.percent),
        };
      }
      return {
        kind: "entity" as const,
        entityId: r.ownerEntityId!,
        percent: parseFloat(r.percent),
      };
    });

    // The base plan's first projection year. plan_settings is seeded at client
    // creation; a client without a row starts now, as creation would have set.
    const scenarioId = await baseCaseScenarioId(clientId, firmId);
    const [settings] = scenarioId
      ? await db
          .select({ planStartYear: planSettings.planStartYear })
          .from(planSettings)
          .where(
            and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)),
          )
      : [];
    const currentYear = new Date().getFullYear();
    const planStartYear = settings?.planStartYear ?? currentYear;

    // An add with no year is dated this calendar year — or the plan's first
    // projection year when the plan starts later, since the engine reads a gift
    // dated before that as already in the authored owners. The route owns the
    // clock; the planner never reads it.
    const plan = planEntityGiftWrites({
      businessId,
      businessValue: parseFloat(business.value),
      authoredOwners,
      householdMembers,
      planStartYear,
      // Same reading as the projection loader's business_interest events: this
      // route is the only writer of these rows and always names a trust
      // recipient and a client/spouse grantor.
      existingGifts: businessGiftRows.map((g) => ({
        id: g.id,
        year: g.year,
        percent: Number(g.percent),
        recipientEntityId: g.recipientEntityId!,
        grantor: g.grantor as "client" | "spouse",
      })),
      op:
        op.op === "add"
          ? {
              op: "add",
              trustId,
              trustIsIrrevocable: trust.isIrrevocable === true,
              percent: op.percent / 100,
              year: op.year ?? Math.max(currentYear, planStartYear),
              valuationDiscount: op.valuationDiscount,
            }
          : { op: "remove", trustId },
    });
    if (plan.error) {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    // Apply the plan in one transaction. A gift writes only `gifts` rows; the
    // authored `entity_owners` baseline is replaced only by a direct retitle.
    await db.transaction(async (tx) => {
      if (plan.ownerRowsToWrite) {
        await tx
          .delete(entityOwners)
          .where(eq(entityOwners.entityId, businessId));
        if (plan.ownerRowsToWrite.length > 0) {
          await tx.insert(entityOwners).values(
            plan.ownerRowsToWrite.map((o) => ({
              entityId: businessId,
              familyMemberId:
                o.kind === "family_member" ? o.familyMemberId : null,
              ownerEntityId: o.kind === "entity" ? o.entityId : null,
              percent: o.percent.toFixed(4),
            })),
          );
        }
      }
      if (plan.giftRows.length > 0) {
        await tx
          .insert(gifts)
          .values(plan.giftRows.map((row) => ({ clientId, ...row })));
      }
      if (plan.giftRowIdsToDelete.length > 0) {
        await tx
          .delete(gifts)
          .where(
            and(
              eq(gifts.clientId, clientId),
              inArray(gifts.id, plan.giftRowIdsToDelete),
            ),
          );
        // As every base-row delete does: a scenario change aimed at a deleted
        // row would point at an id that no longer exists.
        for (const giftId of plan.giftRowIdsToDelete) {
          await pruneOrphanScenarioChanges(tx, giftId, clientId);
        }
      }
    });

    await recordAudit({
      action: "entity.update",
      resourceType: "entity_owners",
      resourceId: businessId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        op:
          op.op === "add"
            ? "assign-business-to-trust"
            : "remove-business-from-trust",
        businessId,
        trustId,
        requestedPercent: op.op === "add" ? op.percent / 100 : 0,
        // The one new value this mutation writes that moves lifetime-exemption
        // consumption — audited alongside the percent it rides with.
        valuationDiscount: op.op === "add" ? op.valuationDiscount ?? null : null,
        appliedDebit: plan.appliedDebit,
        isIrrevocable: trust.isIrrevocable ?? false,
        giftYear: plan.giftRows[0]?.year ?? null,
        giftRowsWritten: plan.giftRows.length,
        giftRowsDeleted: plan.giftRowIdsToDelete.length,
        giftRowIdsDeleted: plan.giftRowIdsToDelete,
        ownersRewritten: plan.ownerRowsToWrite !== null,
      }),
    });

    // Read the new owner state to return.
    const newOwnerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, businessId));

    return NextResponse.json({
      ok: true,
      appliedDebit: plan.appliedDebit,
      owners: newOwnerRows.map((r) => ({
        kind: r.familyMemberId
          ? ("family_member" as const)
          : ("entity" as const),
        familyMemberId: r.familyMemberId,
        entityId: r.ownerEntityId,
        percent: parseFloat(r.percent),
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "POST /api/clients/[id]/entities/[entityId]/assets error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
