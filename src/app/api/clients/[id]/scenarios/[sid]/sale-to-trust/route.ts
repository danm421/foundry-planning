// src/app/api/clients/[id]/scenarios/[sid]/sale-to-trust/route.ts
//
// POST: record an IDGT sale-to-trust event as a toggleable pair:
//
//   1. `scenario_change.edit` on the source account — reassign owners to
//      `[{ kind: "entity", entityId: trustEntityId, percent: 1 }]`.
//   2. A direct `notesReceivable` row (scoped to the client's BASE scenario,
//      matching Phase-1 user-entered notes) carrying the same
//      `toggleGroupId`, so the loader hides the note whenever the source-
//      owner flip is off.
//
// Both writes share a freshly minted `scenarioToggleGroup` so the advisor
// can flip the sale on/off as one unit. The owner flip is a transactional
// scenario_change (transactional via applyEntityEdit's tx). The note insert
// has its own transaction. We accept a small window of partial state on
// failure between the two calls — the toggle group remains harmless if
// orphaned (no changes attached).
//
// Auth model (Task 17d): `requireOrgAndUser` + `requireClientEditAccess` for
// owning firmId and edit-permission gate. Closes the prior edit gap where
// assertScenarioRouteScope had no permission check. VIEW recipients now get 403.
// assertScenarioRouteScope receives the OWNING firmId so cross-org recipients pass.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  scenarios,
  scenarioToggleGroups,
  notesReceivable,
  noteReceivableOwners,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { applyEntityEdit } from "@/lib/scenario/changes-writer";
import type { AccountOwner } from "@/engine/ownership";

// Firm scope is already enforced upstream by assertScenarioRouteScope; this
// helper only needs the base-case scenario lookup.
async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(
      and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)),
    );
  return scenario?.id ?? null;
}

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
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { id: clientId, sid: scenarioId } = await ctx.params;
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

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
    const noteOwners = familyOwners.map((o) => ({
      familyMemberId: o.familyMemberId as string,
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

    // Step 3: insert the new promissory note into notes_receivable. The note
    // is linked to the same toggleGroup as the source-account-owner flip so
    // the pair flips on/off together. Owners come from the source account's
    // prior family-member owners (renormalized above). Note rows live on the
    // BASE scenario (mirrors Phase-1 user-entered notes); visibility in
    // non-base scenarios is gated by the toggle group. Basis equals face
    // value in v1 — the installment-sale economic distinction (note basis =
    // seller's basis in the original asset) is a separate refinement.
    const baseScenarioId = await getBaseCaseScenarioId(clientId);
    if (!baseScenarioId) {
      return NextResponse.json(
        { error: "Client has no base case scenario" },
        { status: 500 },
      );
    }

    const noteId = randomUUID();
    const sourceValueNum = Number(sourceAccount.value);

    await db.transaction(async (tx) => {
      await tx.insert(notesReceivable).values({
        id: noteId,
        clientId,
        scenarioId: baseScenarioId,
        name: `Note from ${sourceAccount.name} sale`,
        faceValue: String(sourceValueNum),
        basis: String(sourceValueNum),
        interestRate: String(body.noteInterestRate),
        paymentType: body.notePaymentType,
        startYear: body.noteStartYear,
        startMonth: 1,
        termMonths: body.noteTermMonths,
        linkedTrustEntityId: body.trustEntityId,
        toggleGroupId: toggleGroup.id,
      });

      for (const o of noteOwners) {
        await tx.insert(noteReceivableOwners).values({
          noteReceivableId: noteId,
          familyMemberId: o.familyMemberId,
          percent: String(o.percent),
        });
      }
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
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        kind: "sale_to_trust",
        scenarioId,
        toggleGroupId: toggleGroup.id,
        sourceAccountId: body.accountId,
        trustEntityId: body.trustEntityId,
        noteReceivableId: noteId,
        noteInterestRate: body.noteInterestRate,
        noteTermMonths: body.noteTermMonths,
        noteStartYear: body.noteStartYear,
        notePaymentType: body.notePaymentType,
      }),
    });

    return NextResponse.json(
      {
        ok: true,
        toggleGroupId: toggleGroup.id,
        noteReceivableId: noteId,
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
