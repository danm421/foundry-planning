// src/lib/analysis/mutations-to-base-updates.ts
//
// Pure transformation: turn an ordered list of SolverMutations into concrete
// UPDATE instructions against the client's BASE entity rows (the plan of
// record). Only five mutation kinds are supported for base-facts writes:
//
//   income-annual-amount  → incomes.annualAmount       (by income id)
//   income-end-year       → incomes.endYear            (by income id)
//   ss-annual-amount      → incomes.annualAmount       (SS row resolved by person)
//   expense-annual-amount → expenses.annualAmount      (by expense id)
//   savings-contribution  → savings_rules.annualAmount (rule resolved by accountId)
//
// Every other kind — including `retirement-age`, which has planEndAge /
// familyMembers side effects we deliberately keep scenario-only — is reported
// in `skipped` rather than emitted as an update. A supported mutation whose
// target row can't be resolved against `tree` (e.g. no SS row for the named
// person) is also skipped with a reason instead of throwing, so a partial
// batch never corrupts an UPDATE's WHERE clause.
//
// Framework-free: no Next, no DB. The route handler turns each BaseUpdate into
// a clientId- and base-scenario-scoped `tx.update(...)`.

import type { ClientData } from "@/engine/types";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";

export interface BaseUpdate {
  table: "incomes" | "expenses" | "savings_rules";
  /** The base entity row id to UPDATE. */
  id: string;
  field: "annualAmount" | "endYear";
  value: number;
}

export interface MutationsToBaseUpdatesResult {
  updates: BaseUpdate[];
  skipped: { kind: string; reason: string }[];
}

export function mutationsToBaseUpdates(
  tree: ClientData,
  mutations: SolverMutation[],
): MutationsToBaseUpdatesResult {
  const updates: BaseUpdate[] = [];
  const skipped: { kind: string; reason: string }[] = [];

  // SS row resolution mirrors mutations-to-scenario-changes / apply-mutations:
  // match the social_security income whose owner equals the named person.
  const ssRowFor = (person: SolverPerson) =>
    tree.incomes.find((i) => i.type === "social_security" && i.owner === person);
  const incomeRowFor = (incomeId: string) =>
    tree.incomes.find((i) => i.id === incomeId);
  const expenseRowFor = (expenseId: string) =>
    tree.expenses.find((e) => e.id === expenseId);
  const savingsRuleFor = (accountId: string) =>
    tree.savingsRules.find((r) => r.accountId === accountId);

  for (const m of mutations) {
    switch (m.kind) {
      case "income-annual-amount": {
        const row = incomeRowFor(m.incomeId);
        if (!row) {
          skipped.push({ kind: m.kind, reason: `income ${m.incomeId} not found in base` });
          break;
        }
        updates.push({
          table: "incomes",
          id: row.id,
          field: "annualAmount",
          value: m.annualAmount,
        });
        break;
      }
      case "income-end-year": {
        const row = incomeRowFor(m.incomeId);
        if (!row) {
          skipped.push({ kind: m.kind, reason: `income ${m.incomeId} not found in base` });
          break;
        }
        updates.push({
          table: "incomes",
          id: row.id,
          field: "endYear",
          value: m.year,
        });
        break;
      }
      case "ss-annual-amount": {
        const row = ssRowFor(m.person);
        if (!row) {
          skipped.push({
            kind: m.kind,
            reason: `no Social Security income row for ${m.person} in base`,
          });
          break;
        }
        updates.push({
          table: "incomes",
          id: row.id,
          field: "annualAmount",
          value: m.amount,
        });
        break;
      }
      case "expense-annual-amount": {
        const row = expenseRowFor(m.expenseId);
        if (!row) {
          skipped.push({ kind: m.kind, reason: `expense ${m.expenseId} not found in base` });
          break;
        }
        updates.push({
          table: "expenses",
          id: row.id,
          field: "annualAmount",
          value: m.annualAmount,
        });
        break;
      }
      case "savings-contribution": {
        const rule = savingsRuleFor(m.accountId);
        if (!rule) {
          skipped.push({
            kind: m.kind,
            reason: `no savings rule for account ${m.accountId} in base`,
          });
          break;
        }
        updates.push({
          table: "savings_rules",
          id: rule.id,
          field: "annualAmount",
          value: m.annualAmount,
        });
        break;
      }
      case "retirement-age": {
        skipped.push({
          kind: m.kind,
          reason: "retirement age can only be saved to a scenario, not base facts",
        });
        break;
      }
      default: {
        skipped.push({
          kind: m.kind,
          reason: "not supported for base-facts writes (scenarios only)",
        });
        break;
      }
    }
  }

  return { updates, skipped };
}
