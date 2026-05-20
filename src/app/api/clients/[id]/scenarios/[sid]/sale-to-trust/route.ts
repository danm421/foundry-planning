// src/app/api/clients/[id]/scenarios/[sid]/sale-to-trust/route.ts
//
// POST: record an IDGT sale-to-trust event as a single toggleable bundle of
// two scenario_changes:
//
//   1. `edit` on the source account — reassign owners to `[{ kind: "entity",
//      entityId: trustEntityId, percent: 1 }]`.
//   2. `add` of a new promissory_note account — owners = the source account's
//      prior family-member owners (with renormalized percents), debtor =
//      trustEntityId, plus the supplied note terms.
//
// Both rows share a freshly minted `scenarioToggleGroup` so the advisor can
// flip the sale on/off as one unit. The toggle group + both writes happen in
// sequence; each writer call wraps its own transaction. We accept a small
// window of partial state on failure between calls — the toggle group will
// remain orphaned but harmless (no changes attached). A future hardening pass
// could collapse all three into a single tx by inlining the writer logic.
//
// Auth model: requireOrgId + assertScenarioRouteScope, matching toggle-groups
// and changes routes.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  scenarioToggleGroups,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import {
  applyEntityAdd,
  applyEntityEdit,
} from "@/lib/scenario/changes-writer";
import type { AccountOwner } from "@/engine/ownership";

export const dynamic = "force-dynamic";

const BODY = z.object({
  accountId: z.string().uuid(),
  trustEntityId: z.string().uuid(),
  noteInterestRate: z.number().positive().max(1),
  noteTermMonths: z.number().int().positive(),
  noteStartYear: z.number().int().min(1900).max(2200),
  notePaymentType: z.enum(["amortizing", "interest_only_balloon"]),
});

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;

    const parsed = BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Load the source account + owners to (a) confirm it belongs to this
    // client and (b) capture the family-member owners we'll re-use on the note.
    const [sourceAccount] = await db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.id, body.accountId), eq(accounts.clientId, clientId)),
      );
    if (!sourceAccount) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 },
      );
    }

    const ownerRows = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, body.accountId));

    // Filter to family-member rows — the note transfers debt obligation to
    // the family side. If the source had any entity owners we refuse: the
    // engine can't sensibly route note payments to a non-family creditor in
    // v1.
    const familyOwners = ownerRows.filter((r) => r.familyMemberId != null);
    if (familyOwners.length === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot sell an account with no family-member owners — note holder is undefined.",
        },
        { status: 400 },
      );
    }
    if (familyOwners.length !== ownerRows.length) {
      return NextResponse.json(
        {
          error:
            "Cannot sell an account with entity owners — clear entity ownership before selling to trust.",
        },
        { status: 400 },
      );
    }

    // Renormalize percents so they sum to 1 across just the family owners
    // (defensive — they already do in well-formed data).
    const familyPercentSum = familyOwners.reduce(
      (sum, o) => sum + Number(o.percent),
      0,
    );
    const noteOwners: AccountOwner[] = familyOwners.map((o) => ({
      kind: "family_member",
      familyMemberId: o.familyMemberId!,
      percent:
        familyPercentSum > 0 ? Number(o.percent) / familyPercentSum : 0,
    }));

    // Step 1: mint a toggle group so both changes can be flipped together.
    const existingGroups = await db
      .select({ orderIndex: scenarioToggleGroups.orderIndex })
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, scenarioId));
    const nextOrderIndex =
      existingGroups.length === 0
        ? 0
        : Math.max(...existingGroups.map((g) => g.orderIndex)) + 1;

    const [toggleGroup] = await db
      .insert(scenarioToggleGroups)
      .values({
        scenarioId,
        name: `Sell ${sourceAccount.name} to trust`,
        defaultOn: true,
        orderIndex: nextOrderIndex,
      })
      .returning();

    const trustOwners: AccountOwner[] = [
      { kind: "entity", entityId: body.trustEntityId, percent: 1 },
    ];

    // Step 2: edit the source account's owners to the trust.
    await applyEntityEdit({
      scenarioId,
      firmId,
      targetKind: "account",
      targetId: body.accountId,
      desiredFields: { owners: trustOwners },
      toggleGroupId: toggleGroup.id,
    });

    // Step 3: add the new promissory note account. The targetId is the new
    // entity's id (a fresh uuid). Field shape matches engine/types.Account.
    const noteId = randomUUID();
    const sourceValueNum = Number(sourceAccount.value);
    const noteEntity = {
      id: noteId,
      name: `Note from ${sourceAccount.name} sale`,
      category: "taxable" as const,
      subType: "promissory_note" as const,
      value: sourceValueNum,
      basis: sourceValueNum,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros" as const,
      noteInterestRate: body.noteInterestRate,
      noteTermMonths: body.noteTermMonths,
      noteStartYear: body.noteStartYear,
      notePaymentType: body.notePaymentType,
      noteLinkedTrustEntityId: body.trustEntityId,
      owners: noteOwners,
    };

    await applyEntityAdd({
      scenarioId,
      firmId,
      targetKind: "account",
      entity: noteEntity,
      toggleGroupId: toggleGroup.id,
    });

    // No dedicated audit action — sale-to-trust is recorded as a compound
    // scenario_change.upsert with the kind nested in metadata. The two writer
    // calls above each emit their own atomic row; this audit captures the
    // human-meaningful event.
    await recordAudit({
      action: "scenario_change.upsert",
      resourceType: "scenario_change",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: {
        kind: "sale_to_trust",
        scenarioId,
        toggleGroupId: toggleGroup.id,
        sourceAccountId: body.accountId,
        trustEntityId: body.trustEntityId,
        noteAccountId: noteId,
        noteInterestRate: body.noteInterestRate,
        noteTermMonths: body.noteTermMonths,
        noteStartYear: body.noteStartYear,
        notePaymentType: body.notePaymentType,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        toggleGroupId: toggleGroup.id,
        noteAccountId: noteId,
      },
      { status: 201 },
    );
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "POST /api/clients/[id]/scenarios/[sid]/sale-to-trust error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
