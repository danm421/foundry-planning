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
        const rule = source.savingsRules.find((r) => r.accountId === m.accountId);
        if (rule && rule.annualAmount !== m.annualAmount) {
          nonClientDrafts.push({
            opType: "edit",
            targetKind: "savings_rule",
            targetId: rule.id,
            payload: {
              annualAmount: { from: rule.annualAmount, to: m.annualAmount },
            },
            orderIndex: 0,
          });
        }
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
