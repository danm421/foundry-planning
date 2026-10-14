// src/lib/whatif/translate.ts
//
// Plain what-if changes → the Solver's own mutations, validated against the
// household they will run on. Pure: the caller hands in the effective tree.
//
// Every mutation produced must pass SOLVER_MUTATION_SCHEMA, the Solver's own
// wire schema, so a translator bug fails here, loudly, instead of reaching the
// engine. Techniques (records built server-side) live in translate-techniques.ts.
import type { ClientData } from "@/engine/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { SolverMutation } from "@/lib/solver/types";
import type { WhatIfChange } from "./changes";
import {
  type Ctx,
  type One,
  fail,
  one,
  findExpense,
  findIncome,
  requireSavingsRule,
  requireSpouse,
  requireSsRow,
  requireYear,
} from "./translate-context";

export interface TranslateResult {
  mutations: SolverMutation[];
  /** Index-aligned with the input: the id of the record each change created or
   *  targeted, else null. `solveFor.roth_amount` reads the conversion id here. */
  recordIds: (string | null)[];
}

export function translateChanges(
  tree: ClientData,
  changes: WhatIfChange[],
  newId: () => string = () => crypto.randomUUID(),
): TranslateResult {
  const mutations: SolverMutation[] = [];
  const recordIds: (string | null)[] = [];
  changes.forEach((change, index) => {
    const ctx: Ctx = { tree, index, newId };
    const out = translateOne(change, ctx);
    for (const m of out.mutations) {
      const check = SOLVER_MUTATION_SCHEMA.safeParse(m);
      if (!check.success) {
        const issue = check.error.issues[0];
        const where = issue?.path.join(".") || "value";
        fail(ctx, `Foundry couldn't build this change (${where}: ${issue?.message ?? "invalid"}).`);
      }
    }
    mutations.push(...out.mutations);
    recordIds.push(out.recordId);
  });
  return { mutations, recordIds };
}

function yearsChange(
  ctx: Ctx,
  current: { startYear: number; endYear: number },
  change: { startYear?: number; endYear?: number },
): { start?: number; end?: number } {
  if (change.startYear === undefined && change.endYear === undefined) {
    fail(ctx, "give startYear, endYear or both.");
  }
  const start = change.startYear ?? current.startYear;
  const end = change.endYear ?? current.endYear;
  if (change.startYear !== undefined) requireYear(ctx, change.startYear, "startYear");
  if (change.endYear !== undefined) requireYear(ctx, change.endYear, "endYear");
  if (start > end) fail(ctx, `startYear ${start} is after endYear ${end}.`);
  return { start: change.startYear, end: change.endYear };
}

function translateOne(change: WhatIfChange, ctx: Ctx): One {
  switch (change.type) {
    case "retirement_age":
      requireSpouse(ctx, change.person);
      return one({
        kind: "retirement-age",
        person: change.person,
        age: change.age,
        ...(change.month !== undefined ? { month: change.month } : {}),
      });
    case "spending_scale":
      return one({ kind: "living-expense-scale", multiplier: change.multiplier });
    case "spending_amount":
      return one({ kind: "living-expense-amount", amount: change.annualAmount });
    case "expense_amount": {
      const e = findExpense(ctx, change.expenseId);
      return one({ kind: "expense-annual-amount", expenseId: e.id, annualAmount: change.annualAmount }, e.id);
    }
    case "income_amount": {
      const inc = findIncome(ctx, change.incomeId);
      if (inc.type === "social_security") {
        fail(ctx, "use ss_pia, ss_annual_benefit or ss_no_benefit for Social Security.");
      }
      return one({ kind: "income-annual-amount", incomeId: inc.id, annualAmount: change.annualAmount }, inc.id);
    }
    case "income_years": {
      const inc = findIncome(ctx, change.incomeId);
      const { start, end } = yearsChange(ctx, inc, change);
      const mutations: SolverMutation[] = [];
      if (start !== undefined) mutations.push({ kind: "income-start-year", incomeId: inc.id, year: start });
      if (end !== undefined) mutations.push({ kind: "income-end-year", incomeId: inc.id, year: end });
      return { mutations, recordId: inc.id };
    }
    case "income_growth": {
      const inc = findIncome(ctx, change.incomeId);
      return {
        mutations: [
          { kind: "income-growth-source", incomeId: inc.id, source: "custom" },
          { kind: "income-growth-rate", incomeId: inc.id, rate: change.growthRate },
        ],
        recordId: inc.id,
      };
    }
    case "ss_claim_age":
      requireSsRow(ctx, change.person);
      // The engine reads claimingAge only in "years" mode (claimAge.ts), so a
      // row in "fra" or "at_retirement" mode would silently ignore the age.
      return {
        mutations: [
          { kind: "ss-claim-age-mode", person: change.person, mode: "years" },
          {
            kind: "ss-claim-age",
            person: change.person,
            age: change.age,
            ...(change.months !== undefined ? { months: change.months } : {}),
          },
        ],
        recordId: null,
      };
    case "ss_pia":
      requireSsRow(ctx, change.person);
      return {
        mutations: [
          { kind: "ss-benefit-mode", person: change.person, mode: "pia_at_fra" },
          { kind: "ss-pia-monthly", person: change.person, amount: change.piaMonthly },
        ],
        recordId: null,
      };
    case "ss_annual_benefit":
      requireSsRow(ctx, change.person);
      return {
        mutations: [
          { kind: "ss-benefit-mode", person: change.person, mode: "manual_amount" },
          { kind: "ss-annual-amount", person: change.person, amount: change.annualAmount },
        ],
        recordId: null,
      };
    case "ss_no_benefit":
      requireSsRow(ctx, change.person);
      return one({ kind: "ss-benefit-mode", person: change.person, mode: "no_benefit" });
    case "ss_cola":
      requireSsRow(ctx, change.person);
      return one({ kind: "ss-cola", person: change.person, rate: change.rate });
    case "savings_amount":
      requireSavingsRule(ctx, change.accountId);
      return {
        mutations: [
          { kind: "savings-annual-percent", accountId: change.accountId, percent: null },
          { kind: "savings-contribution", accountId: change.accountId, annualAmount: change.annualAmount },
        ],
        recordId: change.accountId,
      };
    case "savings_percent":
      requireSavingsRule(ctx, change.accountId);
      return one(
        { kind: "savings-annual-percent", accountId: change.accountId, percent: change.percentOfSalary },
        change.accountId,
      );
    case "savings_roth_percent":
      requireSavingsRule(ctx, change.accountId);
      return one(
        { kind: "savings-roth-percent", accountId: change.accountId, rothPercent: change.rothPercent },
        change.accountId,
      );
    case "savings_max":
      requireSavingsRule(ctx, change.accountId);
      return one(
        { kind: "savings-contribute-max", accountId: change.accountId, value: change.contributeMax },
        change.accountId,
      );
    case "savings_years": {
      requireSavingsRule(ctx, change.accountId);
      const rule = ctx.tree.savingsRules.find((r) => r.accountId === change.accountId)!;
      const { start, end } = yearsChange(ctx, rule, change);
      const mutations: SolverMutation[] = [];
      if (start !== undefined) {
        mutations.push({ kind: "savings-start-year", accountId: change.accountId, year: start, ref: null });
      }
      if (end !== undefined) {
        mutations.push({ kind: "savings-end-year", accountId: change.accountId, year: end, ref: null });
      }
      return { mutations, recordId: change.accountId };
    }
    case "life_expectancy":
      requireSpouse(ctx, change.person);
      return one({ kind: "life-expectancy", person: change.person, age: change.age });
    case "stress_inflation":
      return one({ kind: "stress-inflation", rate: change.rate });
    case "stress_ss_haircut":
      requireYear(ctx, change.startYear, "startYear");
      return one({ kind: "stress-ss-haircut", pct: change.pct, startYear: change.startYear });
    case "stress_market_crash":
      requireYear(ctx, change.year);
      return one({ kind: "stress-market-crash", year: change.year, drawdownPct: change.drawdownPct });
    case "stress_tax_rates":
      requireYear(ctx, change.startYear, "startYear");
      return one({ kind: "stress-tax-rates", points: change.points, startYear: change.startYear });
    case "stress_exemption_cap":
      return one({ kind: "stress-exemption-cap", cap: change.cap });
    case "stress_disability":
      requireSpouse(ctx, change.person);
      requireYear(ctx, change.startYear, "startYear");
      if (change.endYear !== undefined) requireYear(ctx, change.endYear, "endYear");
      return one({
        kind: "stress-disability",
        person: change.person,
        startYear: change.startYear,
        endYear: change.endYear ?? null,
      });
    default:
      fail(ctx, `"${change.type}" isn't supported yet.`);
  }
}
