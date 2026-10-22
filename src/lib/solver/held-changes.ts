// Held changes: Details-editor edits the Solver keeps as unsaved entries.
// Pure and client-safe (no db, no node:).
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { TARGET_KIND_TO_FIELD, applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { foldChanges } from "@/lib/scenario/fold-changes";
import { mutationKey, type HeldChangeMutation, type SolverMutation, type SolverMutationKey } from "./types";

export function isHeldChange(m: SolverMutation): m is HeldChangeMutation {
  return m.kind === "held-change";
}

export function heldScenarioChanges(mutations: readonly SolverMutation[]): ScenarioChange[] {
  return mutations.filter(isHeldChange).map((m, i) => ({
    id: "held:" + mutationKey(m),
    scenarioId: "held",
    opType: m.op,
    targetKind: m.targetKind,
    targetId: m.targetId,
    payload: m.payload,
    toggleGroupId: null,
    orderIndex: i,
  }));
}

/** Display only: no resolution context. */
export function applyHeldChanges(tree: ClientData, mutations: readonly SolverMutation[]): ClientData {
  const held = heldScenarioChanges(mutations);
  if (held.length === 0) return tree;
  return applyScenarioChanges(tree, foldChanges([], held), {}, []).effectiveTree;
}

const UPSERT_TARGET = {
  "account-upsert": "account",
  "liability-upsert": "liability",
  "income-upsert": "income",
  "expense-upsert": "expense",
  "savings-rule-upsert": "savings_rule",
  "entity-upsert": "entity",
  "external-beneficiary-upsert": "external_beneficiary",
} as const;

/** Ids of rows this entry creates (not present in the source plan). */
export function idsCreatedBy(m: SolverMutation, source: ClientData): string[] {
  if (m.kind === "held-change") return m.op === "add" ? [m.targetId] : [];
  if (!(m.kind in UPSERT_TARGET)) return [];
  const upsert = m as Extract<SolverMutation, { kind: keyof typeof UPSERT_TARGET }>;
  if (upsert.value == null) return [];
  const field = TARGET_KIND_TO_FIELD[UPSERT_TARGET[upsert.kind]];
  const list: readonly { id: string }[] = (field && (source[field] as { id: string }[] | undefined)) || [];
  return list.some((r) => r.id === upsert.id) ? [] : [upsert.id];
}

/** Keys of entries whose serialized form mentions any of `ids`. */
export function entriesNaming(
  all: readonly SolverMutation[],
  ids: ReadonlySet<string>,
  except?: SolverMutationKey,
): SolverMutationKey[] {
  const out: SolverMutationKey[] = [];
  for (const m of all) {
    const key = mutationKey(m);
    if (key === except) continue;
    const text = JSON.stringify(m);
    for (const id of ids) {
      if (text.includes(id)) {
        out.push(key);
        break;
      }
    }
  }
  return out;
}
