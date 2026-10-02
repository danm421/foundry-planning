// src/lib/solver/draft-mutations-targeting.ts
//
// Pure, framework-free: which unsaved Solver draft mutations a saved
// Add/Edit/Delete of one plan detail supersedes. After the save lands in the
// scenario, a draft lever aimed at the same row would stack on top of the
// advisor's new values — the host drops exactly what this returns.

import type { FocusKind } from "@/lib/scenario/change-editor-target";
import type { SolverMutation } from "./types";

export interface DraftTarget {
  kind: FocusKind;
  id: string | null;
  /** A savings rule's account (its levers are keyed on the account, not the rule). */
  accountId?: string;
  /** A Social Security row's owner (its levers are keyed on the person). */
  person?: "client" | "spouse";
}

// Upsert kinds that match on `m.id === target.id`, by focus kind.
const UPSERT_KINDS: Partial<Record<FocusKind, SolverMutation["kind"]>> = {
  income: "income-upsert",
  expense: "expense-upsert",
  liability: "liability-upsert",
  account: "account-upsert",
  savings_rule: "savings-rule-upsert",
  note_receivable: "note-receivable-upsert",
  entity: "entity-upsert",
  gift: "gift-upsert",
  will: "will-upsert",
  external_beneficiary: "external-beneficiary-upsert",
  roth_conversion: "roth-conversion-upsert",
  asset_transaction: "asset-transaction-upsert",
  reinvestment: "reinvestment-upsert",
  relocation: "relocation-upsert",
};

export function draftMutationsTargeting(
  mutations: SolverMutation[],
  target: DraftTarget,
): SolverMutation[] {
  // Assumptions singletons and stress levers belong to no row.
  if (target.kind === "plan_settings") return [];
  return mutations.filter((m) => matches(m, target));
}

function matches(m: SolverMutation, target: DraftTarget): boolean {
  const { kind, id } = target;

  if (kind === "client") {
    return m.kind === "retirement-age" || m.kind === "life-expectancy";
  }

  if (id !== null && m.kind === UPSERT_KINDS[kind] && "id" in m && m.id === id) return true;

  switch (kind) {
    case "income":
      if (target.person && m.kind.startsWith("ss-") && "person" in m && m.person === target.person) {
        return true;
      }
      return id !== null && "incomeId" in m && m.incomeId === id;
    case "expense":
      return id !== null && "expenseId" in m && m.expenseId === id;
    case "liability":
      return id !== null && m.kind === "debt-paydown" && m.liabilityId === id;
    case "entity":
      return id !== null && m.kind === "entity-flow-override-upsert" && m.entityId === id;
    case "savings_rule":
    case "account": {
      const accountId = target.accountId ?? id;
      return accountId !== null && m.kind.startsWith("savings-") && "accountId" in m && m.accountId === accountId;
    }
    default:
      return false;
  }
}
