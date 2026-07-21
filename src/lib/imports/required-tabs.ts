import { COMMIT_TABS, type CommitTab } from "./commit/types";
import type { ImportPayload } from "./types";

/**
 * Which payload categories carry at least one row. The wizard derives this
 * from its live edited state; the commit orchestrator derives it from the
 * persisted payload. Both then agree on which tabs must be committed before
 * an import is complete.
 *
 * This type exists because the wizard and the server disagreed for the whole
 * of phase 1: the wizard hid empty tabs, the server required all of them, and
 * no import could ever reach status 'committed'.
 */
export interface CategoryPresence {
  family: boolean;
  accounts: boolean;
  incomes: boolean;
  expenses: boolean;
  liabilities: boolean;
  lifePolicies: boolean;
  wills: boolean;
  entities: boolean;
}

/**
 * Tabs required on EVERY import regardless of what the documents contained.
 * Task 8 adds "plan-basics" here: it is not row-driven, it is the fixed set
 * of values every plan needs.
 */
export const ALWAYS_REQUIRED_TABS: readonly CommitTab[] = ["plan-basics"];

/** One presence flag → the commit tabs it makes mandatory. */
const PRESENCE_TO_TABS: Record<keyof CategoryPresence, CommitTab[]> = {
  family: ["clients-identity", "family-members"],
  accounts: ["accounts"],
  incomes: ["incomes"],
  expenses: ["expenses"],
  liabilities: ["liabilities"],
  lifePolicies: ["life-insurance"],
  wills: ["wills"],
  entities: ["entities"],
};

/**
 * The set of tabs this import must commit to be considered complete,
 * in canonical COMMIT_TABS order.
 */
export function requiredCommitTabs(presence: CategoryPresence): CommitTab[] {
  const required = new Set<CommitTab>(ALWAYS_REQUIRED_TABS);
  for (const [key, tabs] of Object.entries(PRESENCE_TO_TABS)) {
    if (presence[key as keyof CategoryPresence]) {
      for (const t of tabs) required.add(t);
    }
  }
  return COMMIT_TABS.filter((t) => required.has(t));
}

/** Server-side presence, read from the persisted payload. */
export function presenceFromPayload(payload: ImportPayload): CategoryPresence {
  return {
    family:
      payload.primary != null ||
      payload.spouse != null ||
      payload.dependents.length > 0,
    accounts: payload.accounts.length > 0,
    incomes: payload.incomes.length > 0,
    expenses: payload.expenses.length > 0,
    liabilities: payload.liabilities.length > 0,
    lifePolicies: payload.lifePolicies.length > 0,
    wills: payload.wills.length > 0,
    entities: payload.entities.length > 0,
  };
}
