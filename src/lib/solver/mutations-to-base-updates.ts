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

import type { ClientData, Account, SavingsRule, Expense } from "@/engine/types";
import { isRetirementLivingExpense, planLivingExpenseAmount } from "./living-expense";
import type { SolverMutation, SolverPerson } from "./types";

/** A pre-coerced partial column update for one row. */
export type ColumnPatch = Record<string, string | number | boolean | null>;

/** Mutation kinds this helper cannot persist to base facts (see file header).
 *  Used to gate the Save-to-base button and to avoid clearing these from the
 *  working set on a successful save (so they remain savable as a scenario). */
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
  "relocation-upsert",
  "stress-inflation",
  "stress-ss-haircut",
  "stress-disability",
  "stress-market-crash",
  "stress-exemption-cap",
]);

export function isBaseSavableMutation(m: SolverMutation): boolean {
  return !NON_BASE_SAVABLE.has(m.kind);
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
  incomeUpdates: { id: string; set: ColumnPatch }[];
  expenseUpdates: { id: string; set: ColumnPatch }[];
  /** Full new expense rows (e.g. a synthesized retirement living expense). */
  expenseInserts: Expense[];
}

/** number → DB decimal string; null/undefined → null. */
function dec(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

export function mutationsToBaseUpdates(
  source: ClientData,
  mutations: SolverMutation[],
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
    incomeUpdates: [],
    expenseUpdates: [],
    expenseInserts: [],
  };

  const existingAccounts = new Set((source.accounts ?? []).map((a) => a.id));
  const existingRules = new Set((source.savingsRules ?? []).map((r) => r.id));

  // Coalesce field edits per target so multiple levers on one row produce a
  // single partial update.
  const clientPatch: ColumnPatch = {};
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

      // ── Expenses ──────────────────────────────────────────────────────
      case "expense-annual-amount": {
        if (source.expenses?.some((e) => e.id === m.expenseId)) {
          expensePatch(m.expenseId).annualAmount = dec(m.annualAmount);
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
      case "savings-start-year":
        savingsPatch(m.accountId).startYear = m.year;
        break;
      case "savings-end-year":
        savingsPatch(m.accountId).endYear = m.year;
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
      // Techniques (roth-conversion / asset-transaction / reinvestment upserts)
      // are intentionally not handled here — see file header.
    }
  }

  // Finalize client patch.
  if (Object.keys(clientPatch).length > 0) out.clientUpdate = clientPatch;

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
      case "contributeMax": rule.contributeMax = Boolean(v); break;
      case "isDeductible": rule.isDeductible = Boolean(v); break;
      case "applyContributionLimit": rule.applyContributionLimit = Boolean(v); break;
      case "growthSource": rule.growthSource = v as SavingsRule["growthSource"]; break;
    }
  }
}
