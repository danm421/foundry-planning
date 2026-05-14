// src/lib/solver/apply-mutations.ts
//
// Pure function. Given a base ClientData and an ordered list of solver
// mutations, returns a deeply-cloned ClientData with each mutation applied
// in order. The original tree is not modified.
//
// "Last write per lever wins" is the caller's responsibility — pass a
// deduplicated list (see mutationKey() in ./types).

import type { ClientData } from "@/engine/types";
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
  return result;
}
