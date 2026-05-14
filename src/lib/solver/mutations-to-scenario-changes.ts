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
  SolverScenarioChangeDraft,
} from "./types";

export function mutationsToScenarioChanges(
  source: ClientData,
  clientId: string,
  mutations: SolverMutation[],
): SolverScenarioChangeDraft[] {
  const clientFieldDiff: Record<string, { from: unknown; to: unknown }> = {};
  const nonClientDrafts: SolverScenarioChangeDraft[] = [];

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
        const row = source.incomes.find(
          (i) => i.type === "social_security" && i.owner === m.person,
        );
        if (row && row.claimingAge !== m.age) {
          nonClientDrafts.push({
            opType: "edit",
            targetKind: "income",
            targetId: row.id,
            payload: { claimingAge: { from: row.claimingAge, to: m.age } },
            orderIndex: 0,
          });
        }
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
