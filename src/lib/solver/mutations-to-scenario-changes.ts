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
import { planHorizonFromLifeExpectancy } from "@/lib/plan-horizon";
import { isRetirementLivingExpense, planLivingExpenseAmount } from "./living-expense";
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
  // Stress-test overrides all land on planSettings; coalesce into ONE
  // plan_settings edit so multiple stressors don't collide on the
  // (scenarioId, targetKind, targetId, opType) unique index.
  const planSettingsDiff: Record<string, { from: unknown; to: unknown }> = {};
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
  // Coalesce per-expense edits into one expense row per expenseId.
  // `living-expense-scale` (fans out to retirement living expenses) and
  // `expense-annual-amount` (a single expense) can both target the same
  // expense; emitting two `edit` rows would violate the
  // (scenarioId, targetKind, targetId, opType) unique index.
  const expenseDiffs = new Map<
    string,
    { fields: Record<string, { from: unknown; to: unknown }> }
  >();
  const nonClientDrafts: SolverScenarioChangeDraft[] = [];

  // Track the working life expectancies so a post-loop horizon recompute sees
  // the final values even when both spouses' LE levers moved in one batch.
  // Optional-chained: minimal non-client fixtures omit the client singleton.
  let leTouched = false;
  let workingClientLE = source.client?.lifeExpectancy;
  let workingSpouseLE = source.client?.spouseLifeExpectancy;

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

  const accumulateExpense = (
    expenseId: string,
    field: string,
    from: unknown,
    to: unknown,
  ): void => {
    if (from === to) return;
    const entry = expenseDiffs.get(expenseId) ?? { fields: {} };
    entry.fields[field] = { from, to };
    expenseDiffs.set(expenseId, entry);
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
          workingClientLE = m.age;
        } else {
          maybeDiff(
            clientFieldDiff,
            "spouseLifeExpectancy",
            source.client.spouseLifeExpectancy,
            m.age,
          );
          workingSpouseLE = m.age;
        }
        leTouched = true;
        break;
      }
      case "living-expense-scale": {
        const planStartYear = source.planSettings.planStartYear;
        for (const e of source.expenses) {
          if (!isRetirementLivingExpense(e, planStartYear)) continue;
          accumulateExpense(
            e.id,
            "annualAmount",
            e.annualAmount,
            e.annualAmount * m.multiplier,
          );
        }
        break;
      }
      case "living-expense-amount": {
        const plan = planLivingExpenseAmount(source, m.amount);
        if (plan.kind === "synthesize") {
          pushTechniqueUpsert(
            nonClientDrafts,
            "expense",
            undefined,
            plan.expense.id,
            plan.expense as unknown as Record<string, unknown>,
          );
        } else {
          for (const row of plan.rows) {
            accumulateExpense(row.id, "annualAmount", row.from, row.to);
          }
        }
        break;
      }
      case "expense-annual-amount": {
        const expense = source.expenses.find((e) => e.id === m.expenseId);
        if (!expense) break;
        accumulateExpense(
          expense.id,
          "annualAmount",
          expense.annualAmount,
          m.annualAmount,
        );
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
      case "account-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "account",
          source.accounts.find((a) => a.id === m.id) as Record<string, unknown> | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "savings-rule-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "savings_rule",
          (source.savingsRules ?? []).find((r) => r.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "roth-conversion-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "roth_conversion",
          (source.rothConversions ?? []).find((r) => r.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "asset-transaction-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "asset_transaction",
          (source.assetTransactions ?? []).find((t) => t.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "reinvestment-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "reinvestment",
          (source.reinvestments ?? []).find((r) => r.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "relocation-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "relocation",
          (source.relocations ?? []).find((r) => r.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "gift-upsert": {
        // Gifts use a strip-and-rematerialise overlay on reload (see
        // apply-gift-overlays.ts), so there is no add/edit distinction and no
        // need to diff against source.gifts (which is materialised cash-only).
        // value → add(full draft); null → remove. Remove always emits, even for
        // a base asset/series id absent from source.gifts.
        if (m.value === null) {
          nonClientDrafts.push({ opType: "remove", targetKind: "gift", targetId: m.id, payload: null, orderIndex: 0 });
        } else {
          nonClientDrafts.push({ opType: "add", targetKind: "gift", targetId: m.id, payload: m.value as Record<string, unknown>, orderIndex: 0 });
        }
        break;
      }
      case "external-beneficiary-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "external_beneficiary",
          (source.externalBeneficiaries ?? []).find((b) => b.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      case "entity-upsert": {
        pushTechniqueUpsert(
          nonClientDrafts,
          "entity",
          (source.entities ?? []).find((e) => e.id === m.id) as
            | Record<string, unknown>
            | undefined,
          m.id,
          m.value as Record<string, unknown> | null,
        );
        break;
      }
      // ── Stress-test overrides → plan_settings (mirror apply-mutations.ts) ──
      // Without these a saved "Bear case" scenario silently drops its stressors
      // (and the stored MC seed reproduces an UNstressed, higher PoS on reload).
      case "stress-inflation": {
        maybeDiff(
          planSettingsDiff,
          "livingExpenseInflationOverride",
          source.planSettings.livingExpenseInflationOverride ?? null,
          m.rate,
        );
        break;
      }
      case "stress-ss-haircut": {
        planSettingsDiff.ssBenefitHaircut = {
          from: source.planSettings.ssBenefitHaircut ?? null,
          to: { pct: m.pct, startYear: m.startYear },
        };
        break;
      }
      case "stress-disability": {
        planSettingsDiff.disabilityEvent = {
          from: source.planSettings.disabilityEvent ?? null,
          to: { person: m.person, startYear: m.startYear },
        };
        break;
      }
      case "stress-market-crash": {
        planSettingsDiff.marketShock = {
          from: source.planSettings.marketShock ?? null,
          to: { year: m.year, drawdownPct: m.drawdownPct },
        };
        break;
      }
      case "stress-exemption-cap": {
        maybeDiff(
          planSettingsDiff,
          "lifetimeExemptionCap",
          source.planSettings.lifetimeExemptionCap ?? null,
          m.cap,
        );
        break;
      }
    }
  }

  // A life-expectancy change moves the plan horizon (the engine's year loop is
  // bounded by planSettings.planEndYear), so the saved scenario must carry the
  // re-derived planEndAge + planEndYear — mirrors applyMutations and the
  // base-facts PUT route. Skipped when the DOB is missing (no horizon
  // derivable) or nothing actually changed (maybeDiff drops no-op diffs).
  if (leTouched) {
    const horizon = planHorizonFromLifeExpectancy({
      ...source.client,
      lifeExpectancy: workingClientLE,
      spouseLifeExpectancy: workingSpouseLE,
    });
    if (horizon) {
      maybeDiff(clientFieldDiff, "planEndAge", source.client?.planEndAge, horizon.planEndAge);
      maybeDiff(
        planSettingsDiff,
        "planEndYear",
        source.planSettings?.planEndYear,
        horizon.planEndYear,
      );
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
  if (Object.keys(planSettingsDiff).length > 0) {
    // Singleton: targetId is a stable sentinel (not used to locate the row).
    drafts.push({
      opType: "edit",
      targetKind: "plan_settings",
      targetId: "plan_settings",
      payload: planSettingsDiff,
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
  for (const [expenseId, entry] of expenseDiffs.entries()) {
    if (Object.keys(entry.fields).length === 0) continue;
    drafts.push({
      opType: "edit",
      targetKind: "expense",
      targetId: expenseId,
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

/** Shallow field diff for technique edits. Ignores `id`. Uses JSON equality so
 *  array fields (e.g. sourceAccountIds) compare by value. */
function diffTechniqueFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const k of keys) {
    if (k === "id") continue;
    if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) {
      diff[k] = { from: from[k], to: to[k] };
    }
  }
  return diff;
}

function pushTechniqueUpsert(
  drafts: SolverScenarioChangeDraft[],
  targetKind: "account" | "savings_rule" | "roth_conversion" | "asset_transaction" | "reinvestment" | "expense" | "gift" | "external_beneficiary" | "entity" | "relocation",
  existing: Record<string, unknown> | undefined,
  id: string,
  value: Record<string, unknown> | null,
): void {
  if (value === null) {
    if (existing) {
      drafts.push({ opType: "remove", targetKind, targetId: id, payload: null, orderIndex: 0 });
    }
    return;
  }
  if (!existing) {
    drafts.push({ opType: "add", targetKind, targetId: id, payload: value, orderIndex: 0 });
    return;
  }
  const diff = diffTechniqueFields(existing, value);
  if (Object.keys(diff).length > 0) {
    drafts.push({ opType: "edit", targetKind, targetId: id, payload: diff, orderIndex: 0 });
  }
}
