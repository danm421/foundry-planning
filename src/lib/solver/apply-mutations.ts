// src/lib/solver/apply-mutations.ts
//
// Pure function. Given a base ClientData and an ordered list of solver
// mutations, returns a deeply-cloned ClientData with each mutation applied
// in order. The original tree is not modified.
//
// "Last write per lever wins" is the caller's responsibility — pass a
// deduplicated list (see mutationKey() in ./types).

import type { ClientData } from "@/engine/types";
import { resolveRefYears } from "@/lib/year-refs";
import type { SolverMutation } from "./types";

export function applyMutations(
  data: ClientData,
  mutations: SolverMutation[],
): ClientData {
  const result = structuredClone(data);
  for (const m of mutations) {
    switch (m.kind) {
      case "retirement-age": {
        if (m.person === "client") {
          result.client.retirementAge = m.age;
          if (m.month !== undefined) result.client.retirementMonth = m.month;
        } else {
          result.client.spouseRetirementAge = m.age;
          if (m.month !== undefined) result.client.spouseRetirementMonth = m.month;
        }
        break;
      }
      case "living-expense-scale": {
        result.expenses = result.expenses.map((e) =>
          e.type === "living"
            ? { ...e, annualAmount: e.annualAmount * m.multiplier }
            : e,
        );
        break;
      }
      case "expense-annual-amount": {
        result.expenses = result.expenses.map((e) =>
          e.id === m.expenseId ? { ...e, annualAmount: m.annualAmount } : e,
        );
        break;
      }
      case "income-annual-amount": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, annualAmount: m.annualAmount } : i,
        );
        break;
      }
      case "income-growth-rate": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, growthRate: m.rate } : i,
        );
        break;
      }
      case "income-growth-source": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, growthSource: m.source } : i,
        );
        break;
      }
      case "income-tax-type": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, taxType: m.taxType } : i,
        );
        break;
      }
      case "income-self-employment": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, isSelfEmployment: m.value } : i,
        );
        break;
      }
      case "income-start-year": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, startYear: m.year } : i,
        );
        break;
      }
      case "income-end-year": {
        result.incomes = result.incomes.map((i) =>
          i.id === m.incomeId ? { ...i, endYear: m.year } : i,
        );
        break;
      }
      case "ss-claim-age": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? {
                ...i,
                claimingAge: m.age,
                ...(m.months !== undefined ? { claimingAgeMonths: m.months } : {}),
              }
            : i,
        );
        break;
      }
      case "ss-claim-age-mode": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? { ...i, claimingAgeMode: m.mode }
            : i,
        );
        break;
      }
      case "ss-benefit-mode": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? { ...i, ssBenefitMode: m.mode }
            : i,
        );
        break;
      }
      case "ss-pia-monthly": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? { ...i, piaMonthly: m.amount }
            : i,
        );
        break;
      }
      case "ss-annual-amount": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? { ...i, annualAmount: m.amount }
            : i,
        );
        break;
      }
      case "ss-cola": {
        result.incomes = result.incomes.map((i) =>
          i.type === "social_security" && i.owner === m.person
            ? { ...i, growthRate: m.rate }
            : i,
        );
        break;
      }
      case "savings-contribution": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, annualAmount: m.annualAmount } : r,
        );
        break;
      }
      case "savings-annual-percent": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, annualPercent: m.percent } : r,
        );
        break;
      }
      case "savings-roth-percent": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, rothPercent: m.rothPercent } : r,
        );
        break;
      }
      case "savings-contribute-max": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, contributeMax: m.value } : r,
        );
        break;
      }
      case "savings-growth-rate": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, growthRate: m.rate } : r,
        );
        break;
      }
      case "savings-growth-source": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, growthSource: m.source } : r,
        );
        break;
      }
      case "savings-deductible": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, isDeductible: m.value } : r,
        );
        break;
      }
      case "savings-apply-cap": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId
            ? { ...r, applyContributionLimit: m.value }
            : r,
        );
        break;
      }
      case "savings-employer-match-pct": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId
            ? {
                ...r,
                employerMatchPct: m.pct,
                employerMatchCap: m.cap ?? undefined,
              }
            : r,
        );
        break;
      }
      case "savings-employer-match-amount": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId
            ? { ...r, employerMatchAmount: m.amount }
            : r,
        );
        break;
      }
      case "savings-start-year": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, startYear: m.year } : r,
        );
        break;
      }
      case "savings-end-year": {
        result.savingsRules = result.savingsRules.map((r) =>
          r.accountId === m.accountId ? { ...r, endYear: m.year } : r,
        );
        break;
      }
      case "life-expectancy": {
        if (m.person === "client") {
          result.client.lifeExpectancy = m.age;
        } else {
          result.client.spouseLifeExpectancy = m.age;
        }
        break;
      }
    }
  }
  // Reshift every milestone-anchored startYear/endYear so a retirement-age
  // (or any other anchor-moving) mutation flows through to dependent
  // incomes/expenses/savings rules/transfers/roth conversions. Without this,
  // the engine reads stale year windows baked in at load time.
  return resolveRefYears(result);
}
