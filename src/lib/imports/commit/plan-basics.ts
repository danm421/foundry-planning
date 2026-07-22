import { and, eq, inArray } from "drizzle-orm";

import { clients, crmHouseholdContacts, expenses, incomes, planSettings } from "@/db/schema";
import type { YearRef } from "@/lib/milestones";
import { computePlanEndAge, computePlanEndYear } from "@/lib/plan-horizon";
import { livingSlotRole } from "../match-keys/living-slot";
import type { AssemblePlanBasics } from "../assemble/types";
import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Writes the plan-level values the advisor reviewed on the Plan basics step.
 *
 * BLANK IS A VALID COMMITTED STATE. A null field commits as no-change, leaving
 * the seeded $0 row in place — the advisor is flagged, never blocked. That is
 * why every write below is conditional on a non-null value rather than
 * coalescing to 0.
 *
 * THE HORIZON MOVES WITH THE LIFE EXPECTANCY. Writing `clients.lifeExpectancy`
 * alone is not enough: the engine's horizon is `planSettings.planEndYear` (see
 * `src/engine/projection.ts`), and Income & Expenses, estate, insurance,
 * quick-start, milestones and Monte Carlo top-risks all read the STORED
 * `clients.planEndAge`. `applyLifeExpectancyHorizon` re-derives the horizon at
 * projection-load time in the SOLVER only (one production caller,
 * solver-content.tsx) — an earlier version of this docstring cited it as
 * blanket cover, which was wrong. No DB trigger covers it either. So this
 * module recomputes `planEndAge` + `planEndYear` in the same transaction,
 * exactly the way the canonical `PATCH /api/clients/[id]` path does, reusing
 * its `computePlanEndAge` / `computePlanEndYear`.
 */
export async function commitPlanBasics(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const basics = payload.planBasics;
  if (!basics) return result;

  const now = new Date();

  // ── 1. Client horizon columns. ──
  const clientPatch: Record<string, unknown> = {};
  if (basics.retirementAge.value != null) clientPatch.retirementAge = basics.retirementAge.value;
  if (basics.lifeExpectancy.value != null) clientPatch.lifeExpectancy = basics.lifeExpectancy.value;
  if (basics.spouseRetirementAge?.value != null) {
    clientPatch.spouseRetirementAge = basics.spouseRetirementAge.value;
  }
  if (basics.spouseLifeExpectancy?.value != null) {
    clientPatch.spouseLifeExpectancy = basics.spouseLifeExpectancy.value;
  }

  // ── 1b. Plan horizon, folded into the same UPDATE. Only a life expectancy
  //        that actually arrived non-null moves the horizon; a null one is
  //        no-change, exactly like every other field here. ──
  let horizon: { planEndAge: number; planEndYear: number } | null = null;
  if (basics.lifeExpectancy.value != null || basics.spouseLifeExpectancy?.value != null) {
    horizon = await resolvePlanHorizon(tx, ctx, basics);
    if (horizon) {
      clientPatch.planEndAge = horizon.planEndAge;
    } else {
      result.warnings.push(
        "Life expectancy saved, but the plan horizon could not be recomputed — " +
          "no date of birth on file for the primary client.",
      );
    }
  }

  if (Object.keys(clientPatch).length > 0) {
    clientPatch.updatedAt = now;
    await tx
      .update(clients)
      .set(clientPatch)
      .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));
    result.updated += 1;
  }

  if (horizon) {
    // Every scenario, not just this import's — matching the PATCH path, so the
    // engine and UI stay in sync without the advisor re-saving plan settings.
    // Reached only after the org-scoped client read/write above.
    await tx
      .update(planSettings)
      .set({ planEndYear: horizon.planEndYear, updatedAt: now })
      .where(eq(planSettings.clientId, ctx.clientId));
    result.updated += 1;
  }

  // ── 2. Seeded living-expense slots. Amounts only — timing is never touched,
  //       matching the existing slot rule in commit/expenses.ts. Classified
  //       structurally by startYearRef (the same `livingSlotRole` the match
  //       pass uses in match.ts's loadLivingSlots), NOT by name — the name is
  //       a free-text field the advisor can edit in income-expenses-view.tsx,
  //       so a substring test on it would silently mis-route or drop the
  //       write the moment a slot gets renamed. ──
  const slots = await tx
    .select({ id: expenses.id, startYearRef: expenses.startYearRef })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, ctx.clientId),
        eq(expenses.scenarioId, ctx.scenarioId),
        eq(expenses.type, "living"),
        eq(expenses.isDefault, true),
      ),
    );

  for (const slot of slots) {
    const role = livingSlotRole((slot.startYearRef ?? null) as YearRef | null);
    // A slot the classifier can't place is not "current" by default — that
    // would silently write the wrong value. Skip it; the advisor still sees
    // the seeded $0 row and can fix it by hand.
    if (!role) continue;
    const field = role === "retirement" ? basics.retirementLivingSpending : basics.currentLivingSpending;
    if (field.value == null) continue;
    await tx
      .update(expenses)
      .set({ annualAmount: String(field.value), updatedAt: now })
      .where(eq(expenses.id, slot.id));
    result.updated += 1;
  }

  // ── 3. Seeded Social Security rows, matched on type + owner. ──
  for (const row of basics.socialSecurity) {
    const patch: Record<string, unknown> = {};
    if (row.pia.value != null) patch.annualAmount = String(row.pia.value);
    if (row.claimingAge.value != null) patch.claimingAge = row.claimingAge.value;
    if (Object.keys(patch).length === 0) continue;
    patch.updatedAt = now;

    await tx
      .update(incomes)
      .set(patch)
      .where(
        and(
          eq(incomes.clientId, ctx.clientId),
          eq(incomes.scenarioId, ctx.scenarioId),
          eq(incomes.type, "social_security"),
          eq(incomes.owner, row.owner),
        ),
      );
    result.updated += 1;
  }

  return result;
}

/**
 * Re-derive `planEndAge` + `planEndYear` for a household whose life
 * expectancy just changed. Returns null when the primary client has no date of
 * birth on file — the horizon is undefined without it, and the caller degrades
 * to a warning rather than blocking the commit.
 *
 * The dates of birth are NOT on the clients row: identity moved to CRM
 * contacts (`getClientWithContacts` joins them, and the PATCH path reads
 * `primaryContact.dateOfBirth` for exactly this calculation). `CommitContext`
 * carries only resolved `milestones`, which hold no DOB and are loaded by the
 * commit route only when the incomes/expenses tabs are in the request — so a
 * plan-basics-only commit has nothing to reuse. Both reads therefore run on
 * `tx`, not `db`: they must see this transaction's own writes, and a rollback
 * must take them with it.
 *
 * Two plain selects instead of one join: the join lives in
 * `getClientWithContacts`, which is bound to `db` and cannot be handed a `tx`.
 * Org scoping is on the clients read; the contacts read is keyed by the
 * household id that read returned, so it cannot reach another firm.
 *
 * Known ordering residual: `commitClientsIdentity` can also write the CRM
 * contact's dateOfBirth and runs AFTER this tab in `COMMIT_TABS`, so a single
 * commit request carrying BOTH tabs and a document-corrected DOB would derive
 * the horizon from the pre-correction date. Not reachable from the wizard,
 * which commits one tab per click (`TAB_TO_COMMIT`), and self-healing on the
 * next horizon PATCH — reordering COMMIT_TABS to fix it would rewrite an
 * ordering contract several green tests assert on, so it is recorded, not
 * silently changed.
 */
async function resolvePlanHorizon(
  tx: Tx,
  ctx: CommitContext,
  basics: AssemblePlanBasics,
): Promise<{ planEndAge: number; planEndYear: number } | null> {
  const [client] = await tx
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      lifeExpectancy: clients.lifeExpectancy,
      spouseLifeExpectancy: clients.spouseLifeExpectancy,
    })
    .from(clients)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));
  if (!client) return null;

  const contacts = await tx
    .select({ role: crmHouseholdContacts.role, dateOfBirth: crmHouseholdContacts.dateOfBirth })
    .from(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
        inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
      ),
    );
  const clientDob = contacts.find((c) => c.role === "primary")?.dateOfBirth ?? null;
  if (!clientDob) return null;

  // Stored value wins wherever the advisor left the field blank — a blank
  // commits as no-change, so the horizon must be computed against what the
  // row will actually hold after this transaction.
  const planEndAge = computePlanEndAge({
    clientDob,
    clientLifeExpectancy: basics.lifeExpectancy.value ?? client.lifeExpectancy,
    spouseDob: contacts.find((c) => c.role === "spouse")?.dateOfBirth ?? null,
    spouseLifeExpectancy: basics.spouseLifeExpectancy?.value ?? client.spouseLifeExpectancy,
  });
  return { planEndAge, planEndYear: computePlanEndYear(clientDob, planEndAge) };
}
