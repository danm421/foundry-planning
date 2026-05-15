// src/lib/solver/mutations-to-scenario-changes.ts
//
// Pure transformation: turn an ordered list of SolverMutations into draft
// scenarioChanges rows ready for insertion. Edits to the client singleton
// (retirement age + life expectancy, either spouse) coalesce into a single
// `targetKind: "client"` row so we don't violate the
// (scenarioId, targetKind, targetId, opType) unique index.
//
// Returns an empty array (not null) when every mutation is a no-op vs base.

import type { ClientData } from "@/engine/types";
import type {
  SolverMutation,
  SolverPerson,
  SolverScenarioChangeDraft,
} from "./types";

export function mutationsToScenarioChanges(
  source: ClientData,
  clientId: string,
  mutations: SolverMutation[],
): SolverScenarioChangeDraft[] {
  const clientFieldDiff: Record<string, { from: unknown; to: unknown }> = {};
  // Coalesce per-owner SS edits into one income row per owner so the
  // (scenarioId, targetKind, targetId, opType) unique index isn't violated.
  const ssDiffs = new Map<
    SolverPerson,
    { incomeId: string; fields: Record<string, { from: unknown; to: unknown }> }
  >();
  // Coalesce per-rule savings edits into one savings_rule row per accountId
  // for the same reason.
  const savingsDiffs = new Map<
    string,
    { ruleId: string; fields: Record<string, { from: unknown; to: unknown }> }
  >();
  // Coalesce per-income (non-SS) edits into one income row per incomeId.
  const incomeDiffs = new Map<
    string,
    { fields: Record<string, { from: unknown; to: unknown }> }
  >();
  const nonClientDrafts: SolverScenarioChangeDraft[] = [];

  const ssRowFor = (person: SolverPerson) =>
    source.incomes.find((i) => i.type === "social_security" && i.owner === person);

  const accumulateSs = (
    person: SolverPerson,
    field: string,
    from: unknown,
    to: unknown,
  ): void => {
    if (from === to) return;
    const row = ssRowFor(person);
    if (!row) return;
    const entry = ssDiffs.get(person) ?? { incomeId: row.id, fields: {} };
    entry.fields[field] = { from, to };
    ssDiffs.set(person, entry);
  };

  const savingsRuleFor = (accountId: string) =>
    source.savingsRules.find((r) => r.accountId === accountId);

  const accumulateSavings = (
    accountId: string,
    field: string,
    from: unknown,
    to: unknown,
  ): void => {
    if (from === to) return;
    const rule = savingsRuleFor(accountId);
    if (!rule) return;
    const entry = savingsDiffs.get(accountId) ?? { ruleId: rule.id, fields: {} };
    entry.fields[field] = { from, to };
    savingsDiffs.set(accountId, entry);
  };

  const incomeRowFor = (incomeId: string) =>
    source.incomes.find((i) => i.id === incomeId);

  const accumulateIncome = (
    incomeId: string,
    field: string,
    from: unknown,
    to: unknown,
  ): void => {
    if (from === to) return;
    if (!incomeRowFor(incomeId)) return;
    const entry = incomeDiffs.get(incomeId) ?? { fields: {} };
    entry.fields[field] = { from, to };
    incomeDiffs.set(incomeId, entry);
  };

  for (const m of mutations) {
    switch (m.kind) {
      case "retirement-age": {
        if (m.person === "client") {
          maybeDiff(clientFieldDiff, "retirementAge", source.client.retirementAge, m.age);
          if (m.month !== undefined) {
            maybeDiff(
              clientFieldDiff,
              "retirementMonth",
              source.client.retirementMonth ?? 1,
              m.month,
            );
          }
        } else {
          maybeDiff(
            clientFieldDiff,
            "spouseRetirementAge",
            source.client.spouseRetirementAge,
            m.age,
          );
          if (m.month !== undefined) {
            maybeDiff(
              clientFieldDiff,
              "spouseRetirementMonth",
              source.client.spouseRetirementMonth ?? 1,
              m.month,
            );
          }
        }
        break;
      }
      case "life-expectancy": {
        if (m.person === "client") {
          maybeDiff(clientFieldDiff, "lifeExpectancy", source.client.lifeExpectancy, m.age);
        } else {
          maybeDiff(
            clientFieldDiff,
            "spouseLifeExpectancy",
            source.client.spouseLifeExpectancy,
            m.age,
          );
        }
        break;
      }
      case "living-expense-scale": {
        for (const e of source.expenses) {
          if (e.type !== "living") continue;
          const next = e.annualAmount * m.multiplier;
          if (e.annualAmount === next) continue;
          nonClientDrafts.push({
            opType: "edit",
            targetKind: "expense",
            targetId: e.id,
            payload: { annualAmount: { from: e.annualAmount, to: next } },
            orderIndex: 0,
          });
        }
        break;
      }
      case "expense-annual-amount": {
        const expense = source.expenses.find((e) => e.id === m.expenseId);
        if (expense && expense.annualAmount !== m.annualAmount) {
          nonClientDrafts.push({
            opType: "edit",
            targetKind: "expense",
            targetId: expense.id,
            payload: {
              annualAmount: { from: expense.annualAmount, to: m.annualAmount },
            },
            orderIndex: 0,
          });
        }
        break;
      }
      case "income-annual-amount": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(
          m.incomeId,
          "annualAmount",
          inc.annualAmount,
          m.annualAmount,
        );
        break;
      }
      case "income-growth-rate": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(m.incomeId, "growthRate", inc.growthRate, m.rate);
        break;
      }
      case "income-growth-source": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(
          m.incomeId,
          "growthSource",
          inc.growthSource ?? null,
          m.source,
        );
        break;
      }
      case "income-tax-type": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(
          m.incomeId,
          "taxType",
          inc.taxType ?? null,
          m.taxType,
        );
        break;
      }
      case "income-self-employment": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(
          m.incomeId,
          "isSelfEmployment",
          inc.isSelfEmployment ?? false,
          m.value,
        );
        break;
      }
      case "income-start-year": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(m.incomeId, "startYear", inc.startYear, m.year);
        break;
      }
      case "income-end-year": {
        const inc = incomeRowFor(m.incomeId);
        if (!inc) break;
        accumulateIncome(m.incomeId, "endYear", inc.endYear, m.year);
        break;
      }
      case "ss-claim-age": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(m.person, "claimingAge", row.claimingAge, m.age);
        if (m.months !== undefined) {
          accumulateSs(
            m.person,
            "claimingAgeMonths",
            row.claimingAgeMonths ?? 0,
            m.months,
          );
        }
        break;
      }
      case "ss-claim-age-mode": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(m.person, "claimingAgeMode", row.claimingAgeMode ?? "years", m.mode);
        break;
      }
      case "ss-benefit-mode": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(
          m.person,
          "ssBenefitMode",
          row.ssBenefitMode ?? "manual_amount",
          m.mode,
        );
        break;
      }
      case "ss-pia-monthly": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(m.person, "piaMonthly", row.piaMonthly ?? null, m.amount);
        break;
      }
      case "ss-annual-amount": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(m.person, "annualAmount", row.annualAmount, m.amount);
        break;
      }
      case "ss-cola": {
        const row = ssRowFor(m.person);
        if (!row) break;
        accumulateSs(m.person, "growthRate", row.growthRate, m.rate);
        break;
      }
      case "savings-contribution": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(m.accountId, "annualAmount", rule.annualAmount, m.annualAmount);
        break;
      }
      case "savings-annual-percent": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "annualPercent",
          rule.annualPercent ?? null,
          m.percent,
        );
        break;
      }
      case "savings-roth-percent": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "rothPercent",
          rule.rothPercent ?? null,
          m.rothPercent,
        );
        break;
      }
      case "savings-contribute-max": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "contributeMax",
          rule.contributeMax ?? false,
          m.value,
        );
        break;
      }
      case "savings-growth-rate": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "growthRate",
          rule.growthRate ?? null,
          m.rate,
        );
        break;
      }
      case "savings-growth-source": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "growthSource",
          rule.growthSource ?? null,
          m.source,
        );
        break;
      }
      case "savings-deductible": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(m.accountId, "isDeductible", rule.isDeductible, m.value);
        break;
      }
      case "savings-apply-cap": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "applyContributionLimit",
          rule.applyContributionLimit ?? true,
          m.value,
        );
        break;
      }
      case "savings-employer-match-pct": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "employerMatchPct",
          rule.employerMatchPct ?? null,
          m.pct,
        );
        accumulateSavings(
          m.accountId,
          "employerMatchCap",
          rule.employerMatchCap ?? null,
          m.cap,
        );
        break;
      }
      case "savings-employer-match-amount": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(
          m.accountId,
          "employerMatchAmount",
          rule.employerMatchAmount ?? null,
          m.amount,
        );
        break;
      }
      case "savings-start-year": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(m.accountId, "startYear", rule.startYear, m.year);
        break;
      }
      case "savings-end-year": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) break;
        accumulateSavings(m.accountId, "endYear", rule.endYear, m.year);
        break;
      }
    }
  }

  const drafts: SolverScenarioChangeDraft[] = [];
  if (Object.keys(clientFieldDiff).length > 0) {
    drafts.push({
      opType: "edit",
      targetKind: "client",
      targetId: clientId,
      payload: clientFieldDiff,
      orderIndex: 0,
    });
  }
  for (const entry of ssDiffs.values()) {
    if (Object.keys(entry.fields).length === 0) continue;
    drafts.push({
      opType: "edit",
      targetKind: "income",
      targetId: entry.incomeId,
      payload: entry.fields,
      orderIndex: 0,
    });
  }
  for (const entry of savingsDiffs.values()) {
    if (Object.keys(entry.fields).length === 0) continue;
    drafts.push({
      opType: "edit",
      targetKind: "savings_rule",
      targetId: entry.ruleId,
      payload: entry.fields,
      orderIndex: 0,
    });
  }
  for (const [incomeId, entry] of incomeDiffs.entries()) {
    if (Object.keys(entry.fields).length === 0) continue;
    drafts.push({
      opType: "edit",
      targetKind: "income",
      targetId: incomeId,
      payload: entry.fields,
      orderIndex: 0,
    });
  }
  drafts.push(...nonClientDrafts);

  return drafts.map((d, i) => ({ ...d, orderIndex: i }));
}

function maybeDiff(
  acc: Record<string, { from: unknown; to: unknown }>,
  field: string,
  from: unknown,
  to: unknown,
): void {
  if (from === to) return;
  acc[field] = { from, to };
}
