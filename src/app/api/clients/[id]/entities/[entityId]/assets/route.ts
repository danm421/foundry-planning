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
 * When the trust is IRREVOCABLE, the route also inserts a §709-style gift
 * row for every family member who lost share — one row per grantor, with
 * `business_entity_id`, `percent`, and a denormalized `amount` snapshot
 * (= business.value × lostPct) so the report doesn't need to re-multiply.
 *
 * NOT IDEMPOTENT: calling POST twice with the same body transfers share
 * twice AND inserts duplicate gift rows. Callers (the balance-sheet UI)
 * rely on optimistic update + router.refresh to gate double-submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  entities,
  entityOwners,
  familyMembers,
  gifts,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import type { EntityOwner } from "@/engine/ownership";
import { applyEntityOwnersOp, EPSILON } from "@/lib/entity-owners-ops";

export const dynamic = "force-dynamic";

const BUSINESS_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

// Schema mirrors AssetTabOp from src/components/forms/asset-tab-ops.ts.
// Percent comes in as 0-100 (matching the UI); we convert to fraction
// internally before passing to the helper.
const assetOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
    percent: z.number().min(0).max(100),
  }),
  z.object({
    op: z.literal("remove"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
  }),
  z.object({
    op: z.literal("set-percent"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
    percent: z.number().min(0).max(100),
  }),
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

    // Load current owners + household roster.
    const ownerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, businessId));
    const householdMembers = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId));

    const currentOwners: EntityOwner[] = ownerRows.map((r) => {
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

    // Branch the op: `add` debits family share into the trust (and emits gift
    // rows when the trust is irrevocable); `remove` releases the trust's
    // share back to existing family-member rows (or falls back to client/
    // spouse), and never creates gift rows — undoing a transfer doesn't
    // generate a gift event, since the original gift is the source of record.
    const percentFraction = op.op === "add" ? op.percent / 100 : 0;
    const result =
      op.op === "add"
        ? applyEntityOwnersOp(currentOwners, {
            type: "add",
            trustId,
            percent: percentFraction,
          })
        : applyEntityOwnersOp(
            currentOwners,
            { type: "remove", trustId },
            { familyMembers: householdMembers },
          );

    if (op.op === "add" && result.appliedDebit < EPSILON) {
      return NextResponse.json(
        { error: "No share available to assign to trust" },
        { status: 400 },
      );
    }
    if (op.op === "remove") {
      const ownedBefore = currentOwners.some(
        (o) => o.kind === "entity" && o.entityId === trustId,
      );
      if (!ownedBefore) {
        return NextResponse.json(
          { error: "Trust does not own this business" },
          { status: 400 },
        );
      }
    }

    // Persist owner replacement + (optionally) gift rows in one transaction.
    await db.transaction(async (tx) => {
      await tx
        .delete(entityOwners)
        .where(eq(entityOwners.entityId, businessId));

      if (result.newOwners.length > 0) {
        await tx.insert(entityOwners).values(
          result.newOwners.map((o) => ({
            entityId: businessId,
            familyMemberId:
              o.kind === "family_member" ? o.familyMemberId : null,
            ownerEntityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toFixed(4),
          })),
        );
      }

      if (op.op === "add" && trust.isIrrevocable && result.familyLosses.length > 0) {
        const businessValue = parseFloat(business.value);
        const currentYear = new Date().getFullYear();

        const giftRowsToInsert: Array<{
          clientId: string;
          year: number;
          amount: string;
          grantor: "client" | "spouse";
          recipientEntityId: string;
          businessEntityId: string;
          percent: string;
          eventKind: "outright";
        }> = [];

        for (const loss of result.familyLosses) {
          const fm = householdMembers.find((m) => m.id === loss.familyMemberId);
          // Only client/spouse can be a §709 grantor. If the row is owned by
          // a child or "other" family member, skip — gift assignment for
          // those is out of scope for §709 reporting and the gifts.grantor
          // enum only accepts 'client' | 'spouse'.
          if (fm?.role !== "client" && fm?.role !== "spouse") continue;
          const giftAmount = businessValue * loss.lost;
          giftRowsToInsert.push({
            clientId,
            year: currentYear,
            amount: giftAmount.toFixed(2),
            grantor: fm.role,
            recipientEntityId: trustId,
            businessEntityId: businessId,
            percent: loss.lost.toFixed(4),
            eventKind: "outright",
          });
        }

        if (giftRowsToInsert.length > 0) {
          await tx.insert(gifts).values(giftRowsToInsert);
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
        requestedPercent: percentFraction,
        appliedDebit: result.appliedDebit,
        isIrrevocable: trust.isIrrevocable ?? false,
        familyLossCount: result.familyLosses.length,
      }),
    });

    // Read the new owner state to return.
    const newOwnerRows = await db
      .select()
      .from(entityOwners)
      .where(eq(entityOwners.entityId, businessId));

    return NextResponse.json({
      ok: true,
      appliedDebit: result.appliedDebit,
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
