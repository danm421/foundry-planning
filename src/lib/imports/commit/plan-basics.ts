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
  //
  //  The PIA path, not a literal annual amount. `row.pia.value` is a MONTHLY
  //  PIA at full retirement age (see the field's doc comment in
  //  assemble/types.ts), so the row switches to `ssBenefitMode: "pia_at_fra"`
  //  and the engine runs the real actuarial path — early reduction, delayed
  //  credit, spousal and survivor — instead of reading one flat number
  //  forever. `annualAmount` is deliberately NOT written: the engine ignores
  //  it in this mode, and putting a monthly figure in an annual column would
  //  show a 1/12th benefit in every amount-based UI.
  //
  //  WHY THIS DOESN'T DOUBLE-ADJUST THE DOCUMENT PATH. `assemble/plan-basics.ts`
  //  divides the extracted ANNUAL benefit by 12, and its `claimingAgeField`
  //  defaults the claiming age to FRA. In `pia_at_fra` mode with the claim age
  //  AT FRA the engine applies neither a reduction nor a credit, so annual/12 as
  //  the PIA reproduces the same yearly benefit the old literal path produced.
  //  That is EXACT for birth years from 1960 on (FRA 67y0m) and slightly
  //  CONSERVATIVE for 1955-1959 births, whose dropped FRA months leave the claim
  //  age just below true FRA — full analysis on `monthlyPiaFromAnnual` in
  //  `assemble/plan-basics.ts`. A value that came from the planner instead is
  //  already a true monthly PIA at FRA, so the actuarial adjustment is correct
  //  there by construction.
  //
  //  EVERY FIELD STAYS INDIVIDUALLY CONDITIONAL, and `claimingAge` especially.
  //  `commit/incomes.ts` seeds these rows with `claimingAge: … ?? 67` and
  //  `claimingAgeMode: "years"`; the engine's `resolveClaimAgeMonths`
  //  (engine/socialSecurity/claimAge.ts:31) returns NULL for a "years" row with
  //  a null `claimingAge`, `resolveAnnualBenefit` returns ZERO on a null claim
  //  age (orchestrator.ts:76), and income.ts:128 then skips the annualAmount
  //  fallback. So writing a null over the seeded 67 would silently wipe out the
  //  client's entire Social Security while the row advertises a PIA. Same
  //  hazard for `claimingAgeMonths`, which therefore only rides along with an
  //  actual `claimingAge` write.
  for (const row of basics.socialSecurity) {
    const patch: Record<string, unknown> = {};
    if (row.pia.value != null) {
      patch.ssBenefitMode = "pia_at_fra";
      patch.piaMonthly = String(row.pia.value);
    }
    if (row.claimingAge.value != null) {
      patch.claimingAge = row.claimingAge.value;
      patch.claimingAgeMonths = 0;
    }
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
