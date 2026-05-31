// src/lib/solver/mutations-to-base-updates.ts
//
// Pure: classifies the solver's working mutations into base-facts inserts vs
// updates for accounts + savings rules. The route applies them inside an
// org-scoped, audited transaction. (Phase 5 handles account-upsert /
// savings-rule-upsert only; other mutation kinds are out of scope here and are
// ignored — extend later as needed.)

import type { ClientData, Account, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "./types";

export interface BaseUpdates {
  accountInserts: Account[];
  accountUpdates: Account[];
  savingsInserts: SavingsRule[];
  savingsUpdates: SavingsRule[];
}

export function mutationsToBaseUpdates(source: ClientData, mutations: SolverMutation[]): BaseUpdates {
  const out: BaseUpdates = { accountInserts: [], accountUpdates: [], savingsInserts: [], savingsUpdates: [] };
  const existingAccounts = new Set((source.accounts ?? []).map((a) => a.id));
  const existingRules = new Set((source.savingsRules ?? []).map((r) => r.id));
  for (const m of mutations) {
    if (m.kind === "account-upsert") {
      if (m.value === null) continue;
      (existingAccounts.has(m.id) ? out.accountUpdates : out.accountInserts).push(m.value);
    } else if (m.kind === "savings-rule-upsert") {
      if (m.value === null) continue;
      (existingRules.has(m.id) ? out.savingsUpdates : out.savingsInserts).push(m.value);
    }
  }
  return out;
}
