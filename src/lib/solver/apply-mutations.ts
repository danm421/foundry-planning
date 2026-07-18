// src/lib/solver/apply-mutations.ts
//
// Pure function. Given a base ClientData and an ordered list of solver
// mutations, returns a deeply-cloned ClientData with each mutation applied
// in order. The original tree is not modified.
//
// "Last write per lever wins" is the caller's responsibility — pass a
// deduplicated list (see mutationKey() in ./types).

import type { ClientData } from "@/engine/types";
import { planHorizonFromLifeExpectancy } from "@/lib/plan-horizon";
import { resolveRefYears } from "@/lib/year-refs";
import { applyGiftsToClientData, giftEventBelongsTo, type EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { withSynthesizedPremiumGifts } from "@/lib/insurance-policies/premium-gift";
import {
  entityCheckingId,
  makeEntityCheckingAccount,
} from "@/lib/entities/entity-checking";
import { isRetirementLivingExpense, planLivingExpenseAmount } from "./living-expense";
import type { SolverMutation } from "./types";

export function applyMutations(
  data: ClientData,
  mutations: SolverMutation[],
): ClientData {
  const result = structuredClone(data);
  const giftDrafts = new Map<string, EstateFlowGift | null>();
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
        const planStartYear = result.planSettings.planStartYear;
        result.expenses = result.expenses.map((e) =>
          isRetirementLivingExpense(e, planStartYear)
            ? { ...e, annualAmount: e.annualAmount * m.multiplier }
            : e,
        );
        break;
      }
      case "living-expense-amount": {
        const plan = planLivingExpenseAmount(result, m.amount);
        if (plan.kind === "synthesize") {
          result.expenses = [...result.expenses, plan.expense];
        } else {
          const next = new Map(plan.rows.map((r) => [r.id, r.to]));
          result.expenses = result.expenses.map((e) =>
            next.has(e.id) ? { ...e, annualAmount: next.get(e.id)! } : e,
          );
        }
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
      case "roth-conversion-upsert": {
        const list = (result.rothConversions ?? []).filter((r) => r.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.rothConversions = list;
        break;
      }
      case "asset-transaction-upsert": {
        const list = (result.assetTransactions ?? []).filter((t) => t.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.assetTransactions = list;
        break;
      }
      case "reinvestment-upsert": {
        const list = (result.reinvestments ?? []).filter((r) => r.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.reinvestments = list;
        break;
      }
      case "relocation-upsert": {
        const list = (result.relocations ?? []).filter((r) => r.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.relocations = list;
        break;
      }
      case "account-upsert": {
        const list = result.accounts.filter((a) => a.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.accounts = list;
        break;
      }
      case "expense-upsert": {
        const list = result.expenses.filter((e) => e.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.expenses = list;
        break;
      }
      case "savings-rule-upsert": {
        const list = result.savingsRules.filter((r) => r.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.savingsRules = list;
        break;
      }
      case "external-beneficiary-upsert": {
        const list = (result.externalBeneficiaries ?? []).filter((b) => b.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.externalBeneficiaries = list;
        break;
      }
      case "entity-upsert": {
        const list = (result.entities ?? []).filter((e) => e.id !== m.id);
        if (m.value !== null) list.push(m.value);
        result.entities = list;
        // F13: mirror the API path (entities/route.ts:236-260) — an entity with
        // no checking account cannot receive or pay anything, so every trust
        // payment pass silently `continue`s and the scenario computes zeros.
        // The engine keys off isDefaultChecking + full entity ownership
        // (projection.ts:557-563). The account shape and its deterministic id
        // both come from `@/lib/entities/entity-checking` — the loader path
        // calls the same constructor, so the two can no longer drift.
        if (m.value !== null) {
          const entityId = m.value.id;
          const hasChecking = result.accounts.some(
            (a) =>
              a.isDefaultChecking === true &&
              a.owners.some((o) => o.kind === "entity" && o.entityId === entityId),
          );
          if (!hasChecking) {
            result.accounts = [
              ...result.accounts,
              makeEntityCheckingAccount(entityId, m.value.name),
            ];
          }
        } else {
          // Entity deleted: drop only the exact synthesized checking account
          // (same deterministic id as above), never a sweep by ownership —
          // an advisor may have added real accounts owned by this entity and
          // those must survive the entity's removal.
          const syntheticId = entityCheckingId(m.id);
          result.accounts = result.accounts.filter((a) => a.id !== syntheticId);
        }
        break;
      }
      case "stress-inflation": {
        // Living expenses only — the engine pins their growth at this rate.
        // Deliberately does NOT touch planSettings.inflationRate: tax indexing,
        // incomes, savings, and other expenses keep the plan's assumption.
        result.planSettings = {
          ...result.planSettings,
          livingExpenseInflationOverride: m.rate,
        };
        break;
      }
      case "stress-ss-haircut": {
        result.planSettings = {
          ...result.planSettings,
          ssBenefitHaircut: { pct: m.pct, startYear: m.startYear },
        };
        break;
      }
      case "stress-disability": {
        result.planSettings = {
          ...result.planSettings,
          disabilityEvent: { person: m.person, startYear: m.startYear },
        };
        break;
      }
      case "stress-market-crash": {
        result.planSettings = {
          ...result.planSettings,
          marketShock: { year: m.year, drawdownPct: m.drawdownPct },
        };
        break;
      }
      case "stress-exemption-cap": {
        result.planSettings = {
          ...result.planSettings,
          lifetimeExemptionCap: m.cap,
        };
        break;
      }
      case "surplus-allocation": {
        result.planSettings = {
          ...result.planSettings,
          surplusSpendPct: m.spendPct,          // engine reads a number 0–1
          surplusSaveAccountId: m.saveAccountId, // account id | null (null = checking)
        };
        break;
      }
      case "gift-upsert": {
        // Deferred: applied once after the loop so giftEvents is rebuilt from the
        // full scenario draft set (last-write-wins; null marks a delete).
        giftDrafts.set(m.id, m.value);
        break;
      }
    }
  }
  if (giftDrafts.size > 0) {
    const targeted = new Set(giftDrafts.keys());
    const drafts = [...giftDrafts.values()].filter(
      (v): v is EstateFlowGift => v !== null,
    );
    const cpi =
      result.planSettings.taxInflationRate ??
      result.planSettings.inflationRate ??
      0;
    // Strip each targeted gift's existing footprint (base or prior), then
    // re-materialise the new value. Makes "edit a base gift" an in-place
    // override; "remove"/"toggle-off" leave nothing.
    result.gifts = (result.gifts ?? []).filter((g) => !targeted.has(g.id));
    result.giftEvents = (result.giftEvents ?? []).filter(
      (e) => !giftEventBelongsTo(e, targeted),
    );
    const derived = applyGiftsToClientData(
      { ...result, gifts: [], giftEvents: [] },
      drafts,
      cpi,
    );
    result.gifts = [...result.gifts, ...(derived.gifts ?? [])];
    result.giftEvents = [...result.giftEvents, ...derived.giftEvents].sort(
      (a, b) => a.year - b.year,
    );
  }
  // Re-derive Crummey premium gifts from the MUTATED tree so a policy retitled
  // into an ILIT (with crummeyPowers) shows its premium gifts live — the loader
  // runs this before applyMutations, so a same-batch retitle would otherwise get
  // them only after save+reload. Idempotent: strips+re-derives only
  // sourcePolicyAccountId cash events, so Phase 2 scenario gifts survive.
  // Only runs when a policy exists (the synthesis reads client.dateOfBirth,
  // which minimal non-estate solver fixtures omit; no policy → no premium gift).
  if (result.accounts.some((a) => a.category === "life_insurance")) {
    result.giftEvents = withSynthesizedPremiumGifts(result).giftEvents;
  }

  // A life-expectancy lever moves the plan horizon: the engine's year loop is
  // bounded by planSettings.planEndYear (not by LE), so without this recompute
  // raising LE past the stored horizon adds no chart years. Mirrors the
  // base-facts PUT route, which re-derives planEndAge and pushes planEndYear
  // into plan_settings whenever a horizon input changes. Skipped when the DOB
  // is missing (minimal fixtures) — no horizon can be derived.
  if (mutations.some((m) => m.kind === "life-expectancy")) {
    const horizon = planHorizonFromLifeExpectancy(result.client);
    if (horizon) {
      result.client.planEndAge = horizon.planEndAge;
      result.planSettings = {
        ...result.planSettings,
        planEndYear: horizon.planEndYear,
      };
    }
  }

  // Reshift every milestone-anchored startYear/endYear so a retirement-age
  // (or any other anchor-moving) mutation flows through to dependent
  // incomes/expenses/savings rules/transfers/roth conversions. Without this,
  // the engine reads stale year windows baked in at load time.
  return resolveRefYears(result);
}
