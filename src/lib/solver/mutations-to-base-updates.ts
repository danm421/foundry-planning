// src/lib/solver/mutations-to-base-updates.ts
//
// Pure: classifies the solver's working mutations into base-facts writes — for
// the client singleton, incomes, expenses, savings rules, and accounts. The
// route applies them inside an org-scoped, audited transaction (see
// save-to-base/route.ts).
//
// Field-edit kinds emit PARTIAL column updates (only the columns the lever
// changed), mirroring mutations-to-scenario-changes.ts — so engine-unknown
// columns (source, isDefault, year-refs, schedule overrides) are never
// clobbered on a base write. Account / savings-rule upserts carry full entities
// and are classified insert / update / remove against the source tree.
//
// Decimal DB columns must receive strings; this helper pre-coerces partial
// updates to DB-ready values (decimals → string, integers → number, enums /
// booleans → passthrough), so the route can `.set()` them directly.
//
// Out of scope (handled elsewhere or not base-writable from a solver mutation):
//   - `income-self-employment` — engine-only field, no base column.
//   - Techniques (roth-conversion / asset-transaction / reinvestment upserts) —
//     asset-transaction buys carry a resolved `realization` rather than the raw
//     growthSource/modelPortfolioId the base columns need, so they can't
//     round-trip; the others need junction-table writes. Deferred.

import type { ClientData, Account, Income, SavingsRule, Expense } from "@/engine/types";
import { planHorizonFromLifeExpectancy } from "@/lib/plan-horizon";
import { isRetirementLivingExpense, planLivingExpenseAmount } from "./living-expense";
import type { SolverMutation, SolverPerson } from "./types";

/** A pre-coerced partial column update for one row. */
export type ColumnPatch = Record<string, string | number | boolean | null>;

/** Mutation kinds this helper cannot persist to base facts (see file header).
 *  Read through `partitionBaseSavableMutations`, which gates the Save-to-base
 *  button and decides what is kept in the working set on a successful save (so
 *  these remain savable as a scenario). */
const NON_BASE_SAVABLE = new Set<SolverMutation["kind"]>([
  "income-self-employment",
  "roth-conversion-upsert",
  "asset-transaction-upsert",
  "reinvestment-upsert",
  // Estate / relocation techniques: the switch below has no case for these, so
  // they must NOT report base-savable — otherwise Save-to-base drops them
  // silently AND the workspace clears them from the working set (data loss), and
  // a new account funding a not-yet-persisted entity FK-crashes the whole save.
  // They round-trip correctly via save-as-scenario (mutations-to-scenario-changes).
  "gift-upsert",
  "external-beneficiary-upsert",
  "entity-upsert",
  // A will edited by the dissolve-trust lever. `wills` and its bequest /
  // recipient child tables have no base-write path in the switch below, so
  // reporting savable would make Save-to-base drop the cleared recipients AND
  // clear the edit from the working set — leaving a bequest that pays to a
  // trust the same save just deleted. It round-trips via save-as-scenario.
  "will-upsert",
  "relocation-upsert",
  // A liability retitled into a trust has no base-write path in the switch
  // below — reporting savable would make Save-to-base drop it AND clear it from
  // the working set. It round-trips via save-as-scenario.
  "liability-upsert",
  // Scenario-partitioned table with no base-write path here.
  "entity-flow-override-upsert",
  // Same story: notes_receivable is another scenario-partitioned table (its
  // own scenario_id column) with no base-write path in the switch below.
  // Reporting savable would make Save-to-base drop the note AND clear it
  // from the working set. It round-trips via save-as-scenario (Task 5).
  "note-receivable-upsert",
  // Debt paydown writes a liability's extraPayments — a child table with no
  // base-write path here (see promote-table-registry: extra_payment is a
  // nested-only kind). It round-trips via save-as-scenario instead.
  "debt-paydown",
  // Same story: "selected" lives in savings_rule_salary_incomes, a child table
  // this helper's ColumnPatch shape cannot carry (it is scalar columns only)
  // and the route's `.set()` cannot write. Reporting savable would make
  // Save-to-base drop the choice AND clear it from the working set. It
  // round-trips via save-as-scenario, which writes the join rows on promotion
  // (promote-child-writers.writeSavingsRuleChildren).
  "savings-salary-basis",
  "stress-inflation",
  "stress-ss-haircut",
  "stress-disability",
  "stress-market-crash",
  "stress-exemption-cap",
  // PlanSettings.taxRateStress is TypeScript-only — there is no plan_settings
  // column for it, so reporting savable would make Save-to-base drop it AND
  // clear it from the working set.
  "stress-tax-rates",
]);

export function isBaseSavableMutation(m: SolverMutation): boolean {
  return !NON_BASE_SAVABLE.has(m.kind);
}

/** The Save-to-base split of one working set. */
export interface BaseSavablePartition {
  /** Sent to the save-to-base route, and cleared from the working set after. */
  savable: SolverMutation[];
  /** Kept in the working set so the advisor can still save them as a scenario. */
  held: SolverMutation[];
  /** Ids of the account edits held back by a paired note rather than by their
   *  own kind — i.e. the sales this save is leaving pending. Non-empty means
   *  the advisor must be told, or the flip "silently doesn't save". */
  heldSaleAccountIds: string[];
  /** Ids of the trusts whose REMOVAL is being left pending — the second class
   *  of mutation held by its pairing rather than by its own kind. Non-empty
   *  means the advisor must be told, or "Save to base facts" writes half a trust
   *  removal to the client's real record. */
  heldDissolveEntityIds: string[];
}

/**
 * Split a working set into what Save-to-base may write and what must stay behind.
 *
 * Per-kind savability (`isBaseSavableMutation`) is not enough, because a sale to a
 * trust is ONE advisor action emitted as TWO mutations: the source account's owner
 * flip into the trust (`account-upsert`, base-savable — the route really does
 * re-materialize `account_owners`) and the promissory note the family now holds
 * (`note-receivable-upsert`, never base-savable — `notes_receivable` is
 * scenario-partitioned). Classified one at a time, Save-to-base posts the flip and
 * drops the note: the asset is permanently retitled into the trust on the client's
 * REAL record with nothing owed for it, value leaves the taxable estate for free,
 * and the note left in the working set makes the sale look like it is still pending.
 *
 * So the account half is held whenever its note is held. The pairing is DECLARED by
 * the note's `sourceAccountId` (set by `submitSaleToTrust` to the same account id
 * the paired `account-upsert` carries), never inferred from `owners` shapes — a
 * sale's retitle and a plain revocable-trust funding retitle produce a byte-
 * identical `owners` array.
 *
 * The unit that cannot be half-saved is the SALE, not the kind: `account-upsert` is
 * the solver's most common mutation and stays base-savable on its own.
 *
 * A trust REMOVAL is the same shape and the same hazard. `buildDissolveTrustMutations`
 * emits a mix: the `account-upsert` retitles and the `income-upsert` / `expense-upsert`
 * returns are base-savable, while `entity-upsert: null`, `will-upsert`,
 * `liability-upsert` and `gift-upsert` are not. Split, the real record keeps the
 * trust's accounts titled to the grantor while the trust still exists, the will
 * still names it, and the gifts to it are still there — and the applied half is
 * already gone from the working set. So the whole removal is held together, again
 * on a DECLARED pairing (`dissolvedEntityId`) and never on an inferred one: a
 * retitle out of a trust is byte-identical to any other owner change.
 */
export function partitionBaseSavableMutations(
  mutations: readonly SolverMutation[],
): BaseSavablePartition {
  // Accounts whose sale note is being held back. A note that IS base-savable
  // (no kind is today, but the set is data) holds nothing — it saves alongside.
  const pairedAccountIds = new Set<string>();
  for (const m of mutations) {
    if (m.kind !== "note-receivable-upsert") continue;
    if (isBaseSavableMutation(m)) continue;
    if (m.sourceAccountId) pairedAccountIds.add(m.sourceAccountId);
  }

  // Trusts this working set is REMOVING. `entity-upsert` is never base-savable,
  // so a present delete is always a held delete — but the membership test still
  // matters: a declared retitle whose entity delete is absent (already saved, or
  // the removal undone) must not be held hostage to a phantom.
  const dissolvedEntityIds = new Set<string>();
  for (const m of mutations) {
    if (m.kind !== "entity-upsert" || m.value !== null) continue;
    if (isBaseSavableMutation(m)) continue;
    dissolvedEntityIds.add(m.id);
  }

  const savable: SolverMutation[] = [];
  const held: SolverMutation[] = [];
  const heldSaleAccountIds: string[] = [];
  const heldDissolveEntityIds: string[] = [];
  for (const m of mutations) {
    const heldBySale = m.kind === "account-upsert" && pairedAccountIds.has(m.id);
    if (heldBySale) heldSaleAccountIds.push(m.id);
    const declared = declaredDissolveTarget(m);
    const heldByDissolve = declared != null && dissolvedEntityIds.has(declared);
    if (heldByDissolve && !heldDissolveEntityIds.includes(declared)) {
      heldDissolveEntityIds.push(declared);
    }
    const heldByPair = heldBySale || heldByDissolve;
    (isBaseSavableMutation(m) && !heldByPair ? savable : held).push(m);
  }
  return { savable, held, heldSaleAccountIds, heldDissolveEntityIds };
}

/** The trust whose dissolve declared this mutation, or null. Only three kinds
 *  carry the field; the `in` check is what keeps the union narrowing honest. */
function declaredDissolveTarget(m: SolverMutation): string | null {
  if (m.kind !== "account-upsert" && m.kind !== "income-upsert" && m.kind !== "expense-upsert") {
    return null;
  }
  return m.dissolvedEntityId ?? null;
}

export interface BaseUpdates {
  accountInserts: Account[];
  accountUpdates: Account[];
  accountRemoves: string[];
  savingsInserts: SavingsRule[];
  /** Full-row updates from a `savings-rule-upsert` against an existing rule. */
  savingsUpdates: SavingsRule[];
  savingsRemoves: string[];
  /** Partial-column updates to existing savings rules from field-edit levers. */
  savingsFieldUpdates: { id: string; set: ColumnPatch }[];
  /** Partial update to the clients row (firm-scoped, not scenario-scoped). */
  clientUpdate: ColumnPatch | null;
  /** Partial update to plan_settings (all the client's scenarios) — emitted
   *  when a life-expectancy edit moves the plan horizon (planEndYear). */
  planSettingsUpdate: ColumnPatch | null;
  incomeUpdates: { id: string; set: ColumnPatch }[];
  /** Full new income rows added by an `income-upsert` on a row absent from base. */
  incomeInserts: Income[];
  /** Full-row updates from an `income-upsert` against an existing base income. */
  incomeFullUpdates: Income[];
  /** Base income ids removed by an `income-upsert` with a null value. */
  incomeRemoves: string[];
  expenseUpdates: { id: string; set: ColumnPatch }[];
  /** Full new expense rows (e.g. a synthesized retirement living expense). */
  expenseInserts: Expense[];
  /** Full-row updates from an `expense-upsert` against an existing base expense. */
  expenseFullUpdates: Expense[];
  /** Base expense ids removed by an `expense-upsert` with a null value. */
  expenseRemoves: string[];
}

/**
 * Row-id membership of the BASE scenario, used to classify account / savings-rule
 * upserts as insert-vs-update. Supplied by the route when `source` is a non-base
 * scenario: an overlay-added row is present in `source` but ABSENT from base, so
 * classifying against `source` would emit a base-scoped UPDATE that touches 0 rows
 * — a silent no-op reported as success. Classifying against base membership makes
 * that row an INSERT instead. When `source` IS base, source membership already
 * equals base membership, so this can be omitted.
 */
export interface BaseMembership {
  accountIds: ReadonlySet<string>;
  ruleIds: ReadonlySet<string>;
  expenseIds?: ReadonlySet<string>;
  incomeIds?: ReadonlySet<string>;
}

/** number → DB decimal string; null/undefined → null. */
function dec(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

export function mutationsToBaseUpdates(
  source: ClientData,
  mutations: SolverMutation[],
  baseMembership?: BaseMembership,
): BaseUpdates {
  const out: BaseUpdates = {
    accountInserts: [],
    accountUpdates: [],
    accountRemoves: [],
    savingsInserts: [],
    savingsUpdates: [],
    savingsRemoves: [],
    savingsFieldUpdates: [],
    clientUpdate: null,
    planSettingsUpdate: null,
    incomeUpdates: [],
    incomeInserts: [],
    incomeFullUpdates: [],
    incomeRemoves: [],
    expenseUpdates: [],
    expenseInserts: [],
    expenseFullUpdates: [],
    expenseRemoves: [],
  };

  // Classify account / savings-rule upserts against BASE membership when the
  // route supplies it (source is a non-base scenario); otherwise fall back to the
  // source tree, which — when source IS base — is identical. See BaseMembership.
  const existingAccounts =
    baseMembership?.accountIds ?? new Set((source.accounts ?? []).map((a) => a.id));
  const existingRules =
    baseMembership?.ruleIds ?? new Set((source.savingsRules ?? []).map((r) => r.id));
  const existingExpenses =
    baseMembership?.expenseIds ?? new Set((source.expenses ?? []).map((e) => e.id));
  const existingIncomes =
    baseMembership?.incomeIds ?? new Set((source.incomes ?? []).map((i) => i.id));

  // Coalesce field edits per target so multiple levers on one row produce a
  // single partial update.
  const clientPatch: ColumnPatch = {};
  const planSettingsPatch: ColumnPatch = {};
  const incomePatches = new Map<string, ColumnPatch>();
  const expensePatches = new Map<string, ColumnPatch>();
  // Field edits keyed by accountId; resolved to a rule id (existing) or folded
  // into a fresh insert (new account) in a second pass.
  const savingsPatchesByAccount = new Map<string, ColumnPatch>();

  const ssIdFor = (person: SolverPerson): string | undefined =>
    source.incomes?.find((i) => i.type === "social_security" && i.owner === person)?.id;

  const incomePatch = (id: string): ColumnPatch => {
    const p = incomePatches.get(id) ?? {};
    incomePatches.set(id, p);
    return p;
  };
  const expensePatch = (id: string): ColumnPatch => {
    const p = expensePatches.get(id) ?? {};
    expensePatches.set(id, p);
    return p;
  };
  const savingsPatch = (accountId: string): ColumnPatch => {
    const p = savingsPatchesByAccount.get(accountId) ?? {};
    savingsPatchesByAccount.set(accountId, p);
    return p;
  };

  for (const m of mutations) {
    switch (m.kind) {
      // ── Client singleton ──────────────────────────────────────────────
      case "retirement-age": {
        if (m.person === "client") {
          clientPatch.retirementAge = m.age;
          if (m.month !== undefined) clientPatch.retirementMonth = m.month;
        } else {
          clientPatch.spouseRetirementAge = m.age;
          if (m.month !== undefined) clientPatch.spouseRetirementMonth = m.month;
        }
        break;
      }
      case "life-expectancy": {
        if (m.person === "client") clientPatch.lifeExpectancy = m.age;
        else clientPatch.spouseLifeExpectancy = m.age;
        break;
      }

      // ── Plan settings ─────────────────────────────────────────────────
      case "surplus-allocation": {
        planSettingsPatch.surplusSpendPct = dec(m.spendPct);      // decimal → DB string
        planSettingsPatch.surplusSaveAccountId = m.saveAccountId; // account id | null
        planSettingsPatch.surplusSpendAllUntilRetirement = m.spendAllUntilRetirement; // boolean column
        break;
      }

      // ── Expenses ──────────────────────────────────────────────────────
      case "expense-annual-amount": {
        if (source.expenses?.some((e) => e.id === m.expenseId)) {
          expensePatch(m.expenseId).annualAmount = dec(m.annualAmount);
        }
        break;
      }
      case "expense-absorbs-remaining": {
        if (source.expenses?.some((e) => e.id === m.expenseId)) {
          expensePatch(m.expenseId).absorbsRemainingCashFlow = m.value;
        }
        break;
      }
      case "living-expense-scale": {
        const planStartYear = source.planSettings.planStartYear;
        for (const e of source.expenses ?? []) {
          if (!isRetirementLivingExpense(e, planStartYear)) continue;
          const next = e.annualAmount * m.multiplier;
          if (next === e.annualAmount) continue;
          expensePatch(e.id).annualAmount = dec(next);
        }
        break;
      }
      case "living-expense-amount": {
        const plan = planLivingExpenseAmount(source, m.amount);
        if (plan.kind === "synthesize") {
          out.expenseInserts.push(plan.expense);
        } else {
          for (const row of plan.rows) {
            if (row.to === row.from) continue;
            expensePatch(row.id).annualAmount = dec(row.to);
          }
        }
        break;
      }

      // ── Incomes ───────────────────────────────────────────────────────
      case "income-annual-amount":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).annualAmount = dec(m.annualAmount);
        break;
      case "income-growth-rate":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).growthRate = dec(m.rate);
        break;
      case "income-growth-source":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).growthSource = m.source;
        break;
      case "income-tax-type":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).taxType = m.taxType;
        break;
      case "income-start-year":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).startYear = m.year;
        break;
      case "income-end-year":
        if (hasIncome(source, m.incomeId)) incomePatch(m.incomeId).endYear = m.year;
        break;
      // income-self-employment has no DB column — silently dropped.
      case "income-self-employment":
        break;

      // ── Social Security (income rows) ─────────────────────────────────
      case "ss-claim-age": {
        const id = ssIdFor(m.person);
        if (id) {
          incomePatch(id).claimingAge = m.age;
          if (m.months !== undefined) incomePatch(id).claimingAgeMonths = m.months;
        }
        break;
      }
      case "ss-claim-age-mode": {
        const id = ssIdFor(m.person);
        if (id) incomePatch(id).claimingAgeMode = m.mode;
        break;
      }
      case "ss-benefit-mode": {
        const id = ssIdFor(m.person);
        if (id) incomePatch(id).ssBenefitMode = m.mode;
        break;
      }
      case "ss-pia-monthly": {
        const id = ssIdFor(m.person);
        if (id) incomePatch(id).piaMonthly = dec(m.amount);
        break;
      }
      case "ss-annual-amount": {
        const id = ssIdFor(m.person);
        if (id) incomePatch(id).annualAmount = dec(m.amount);
        break;
      }
      case "ss-cola": {
        const id = ssIdFor(m.person);
        if (id) incomePatch(id).growthRate = dec(m.rate);
        break;
      }

      // ── Savings rule field edits (keyed by accountId) ─────────────────
      case "savings-contribution":
        savingsPatch(m.accountId).annualAmount = dec(m.annualAmount);
        break;
      case "savings-annual-percent":
        savingsPatch(m.accountId).annualPercent = dec(m.percent);
        break;
      case "savings-roth-percent":
        savingsPatch(m.accountId).rothPercent = dec(m.rothPercent);
        break;
      case "savings-contribute-max":
        savingsPatch(m.accountId).contributeMax = m.value;
        break;
      case "savings-growth-rate":
        savingsPatch(m.accountId).growthRate = dec(m.rate);
        break;
      case "savings-growth-source":
        savingsPatch(m.accountId).growthSource = m.source;
        break;
      case "savings-deductible":
        savingsPatch(m.accountId).isDeductible = m.value;
        break;
      case "savings-apply-cap":
        savingsPatch(m.accountId).applyContributionLimit = m.value;
        break;
      case "savings-employer-match-pct": {
        const p = savingsPatch(m.accountId);
        p.employerMatchPct = dec(m.pct);
        p.employerMatchCap = dec(m.cap);
        break;
      }
      case "savings-employer-match-amount":
        savingsPatch(m.accountId).employerMatchAmount = dec(m.amount);
        break;
      // The ref column is written whenever the mutation carries the key, an
      // explicit null included — picking a plain calendar year has to clear the
      // milestone anchor, or the stored rule silently re-anchors on next load.
      case "savings-start-year":
        savingsPatch(m.accountId).startYear = m.year;
        if ("ref" in m) savingsPatch(m.accountId).startYearRef = m.ref ?? null;
        break;
      case "savings-end-year":
        savingsPatch(m.accountId).endYear = m.year;
        if ("ref" in m) savingsPatch(m.accountId).endYearRef = m.ref ?? null;
        break;

      // ── Full-entity upserts ───────────────────────────────────────────
      case "account-upsert": {
        if (m.value === null) {
          if (existingAccounts.has(m.id)) out.accountRemoves.push(m.id);
        } else {
          (existingAccounts.has(m.id) ? out.accountUpdates : out.accountInserts).push(m.value);
        }
        break;
      }
      case "savings-rule-upsert": {
        if (m.value === null) {
          if (existingRules.has(m.id)) out.savingsRemoves.push(m.id);
        } else {
          (existingRules.has(m.id) ? out.savingsUpdates : out.savingsInserts).push(m.value);
        }
        break;
      }
      case "income-upsert": {
        if (m.value === null) {
          if (existingIncomes.has(m.id)) out.incomeRemoves.push(m.id);
        } else {
          (existingIncomes.has(m.id) ? out.incomeFullUpdates : out.incomeInserts).push(m.value);
        }
        break;
      }
      case "expense-upsert": {
        if (m.value === null) {
          if (existingExpenses.has(m.id)) out.expenseRemoves.push(m.id);
        } else {
          (existingExpenses.has(m.id) ? out.expenseFullUpdates : out.expenseInserts).push(m.value);
        }
        break;
      }
      // Techniques (roth-conversion / asset-transaction / reinvestment upserts)
      // are intentionally not handled here — see file header.
    }
  }

  // Finalize client patch.
  // A life-expectancy edit moves the plan horizon (the engine's year loop is
  // bounded by planSettings.planEndYear), so persist the re-derived planEndAge
  // alongside it and hand the route a planEndYear patch — mirrors the
  // base-facts PUT route. Skipped when the DOB is missing (no horizon
  // derivable from the source tree).
  if (mutations.some((m) => m.kind === "life-expectancy")) {
    // Optional-chained: minimal non-client fixtures omit the client singleton.
    const horizon = planHorizonFromLifeExpectancy({
      ...source.client,
      lifeExpectancy:
        (clientPatch.lifeExpectancy as number | undefined) ??
        source.client?.lifeExpectancy,
      spouseLifeExpectancy:
        (clientPatch.spouseLifeExpectancy as number | undefined) ??
        source.client?.spouseLifeExpectancy,
    });
    if (horizon) {
      clientPatch.planEndAge = horizon.planEndAge;
      planSettingsPatch.planEndYear = horizon.planEndYear;
    }
  }

  if (Object.keys(clientPatch).length > 0) out.clientUpdate = clientPatch;
  if (Object.keys(planSettingsPatch).length > 0) out.planSettingsUpdate = planSettingsPatch;

  // Finalize income / expense partial updates.
  for (const [id, set] of incomePatches) {
    if (Object.keys(set).length > 0) out.incomeUpdates.push({ id, set });
  }
  for (const [id, set] of expensePatches) {
    if (Object.keys(set).length > 0) out.expenseUpdates.push({ id, set });
  }

  // Resolve savings field-edit patches: fold into a fresh insert when the
  // account is new in this batch, else emit a partial update to the existing
  // rule. (A new account's later field edits would otherwise be lost, since the
  // upsert snapshot predates them.)
  const insertRuleByAccount = new Map<string, SavingsRule>();
  for (const r of out.savingsInserts) insertRuleByAccount.set(r.accountId, r);
  for (const [accountId, set] of savingsPatchesByAccount) {
    if (Object.keys(set).length === 0) continue;
    const freshRule = insertRuleByAccount.get(accountId);
    if (freshRule) {
      foldPatchIntoRule(freshRule, set);
      continue;
    }
    const rule = source.savingsRules?.find((r) => r.accountId === accountId);
    if (rule) out.savingsFieldUpdates.push({ id: rule.id, set });
  }

  return out;
}

function hasIncome(source: ClientData, incomeId: string): boolean {
  return !!source.incomes?.some((i) => i.id === incomeId);
}

/** Apply a pre-coerced column patch back onto an engine SavingsRule (so a fresh
 *  insert reflects later field edits). DB strings are parsed back to numbers. */
function foldPatchIntoRule(rule: SavingsRule, set: ColumnPatch): void {
  const num = (v: unknown): number | null =>
    v == null ? null : typeof v === "number" ? v : Number(v);
  for (const [k, v] of Object.entries(set)) {
    switch (k) {
      case "annualAmount": rule.annualAmount = num(v) ?? 0; break;
      case "annualPercent": rule.annualPercent = num(v); break;
      case "rothPercent": rule.rothPercent = num(v); break;
      case "growthRate": rule.growthRate = num(v) ?? undefined; break;
      case "employerMatchPct": rule.employerMatchPct = num(v) ?? undefined; break;
      case "employerMatchCap": rule.employerMatchCap = num(v) ?? undefined; break;
      case "employerMatchAmount": rule.employerMatchAmount = num(v) ?? undefined; break;
      case "startYear": rule.startYear = num(v) ?? rule.startYear; break;
      case "endYear": rule.endYear = num(v) ?? rule.endYear; break;
      case "startYearRef": rule.startYearRef = (v as string | null) ?? null; break;
      case "endYearRef": rule.endYearRef = (v as string | null) ?? null; break;
      case "contributeMax": rule.contributeMax = Boolean(v); break;
      case "isDeductible": rule.isDeductible = Boolean(v); break;
      case "applyContributionLimit": rule.applyContributionLimit = Boolean(v); break;
      case "growthSource": rule.growthSource = v as SavingsRule["growthSource"]; break;
    }
  }
}
