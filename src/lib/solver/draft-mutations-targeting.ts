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
  /** A living expense the `living-expense-scale` / `living-expense-amount` levers rewrite. */
  livingExpense?: boolean;
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
  const hit = new Set(mutations.filter((m) => matches(m, target)));
  // A declared pair stands or falls together: a note's sale also retitled its
  // source account, and `partitionBaseSavableMutations` holds one half back
  // only while the other is still present.
  for (const m of [...hit]) {
    if (m.kind !== "note-receivable-upsert" || !m.sourceAccountId) continue;
    for (const o of mutations) {
      if (o.kind === "account-upsert" && o.id === m.sourceAccountId) hit.add(o);
    }
  }
  return mutations.filter((m) => hit.has(m));
}

function matches(m: SolverMutation, target: DraftTarget): boolean {
  const { kind, id } = target;

  // The Assumptions singletons: the withdrawal tab owns the surplus split.
  if (kind === "plan_settings") return id === "withdrawal" && m.kind === "surplus-allocation";

  if (kind === "client") {
    return m.kind === "retirement-age" || m.kind === "life-expectancy";
  }

  if (id !== null && m.kind === UPSERT_KINDS[kind] && "id" in m && m.id === id) return true;

  // A trust dissolve / charity removal tags every companion mutation with the
  // removed row's id.
  if ((kind === "entity" || kind === "external_beneficiary") && id !== null) {
    if ("removedRefId" in m && m.removedRefId === id) return true;
  }

  switch (kind) {
    case "income":
      if (target.person && m.kind.startsWith("ss-") && "person" in m && m.person === target.person) {
        return true;
      }
      return id !== null && "incomeId" in m && m.incomeId === id;
    case "expense":
      if (target.livingExpense && (m.kind === "living-expense-scale" || m.kind === "living-expense-amount")) {
        return true;
      }
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
