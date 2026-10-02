"use client";

// When an Add / Edit / Delete saves into the scenario, an unsaved Solver draft
// lever aimed at the same row would stack on top of the advisor's new values.
// This turns the host's write events into "drop exactly those draft mutations"
// plus a dismissible notice naming what was replaced.
//
// The inventory is the PERSISTED plan (never the working tree), so a row's
// `draftRef` — the levers keyed on its account or person rather than its id —
// is looked up there. A write with no inventory item (a create, a change
// clicked in the list) is targeted by kind and id alone.

import { useCallback, useMemo, useState } from "react";
import { detailType } from "@/lib/scenario/plan-detail-catalog";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { ScenarioWriteEvent } from "@/hooks/scenario-write-listener";
import { draftMutationsTargeting, type DraftTarget } from "@/lib/solver/draft-mutations-targeting";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";

interface Args {
  inventory: InventoryItem[];
  mutations: SolverMutation[];
  /** Drops the keys from the draft and marks the Solver's results stale. */
  clearMutations: (keys: SolverMutationKey[]) => void;
}

export function useDraftReconciliation({ inventory, mutations, clearMutations }: Args) {
  const [notice, setNotice] = useState<string | null>(null);

  // `${focus kind}:${row id}` — a write names its kind, the inventory its type.
  const itemByTarget = useMemo(
    () => new Map(inventory.map((i) => [`${detailType(i.typeKey).kind}:${i.id}`, i])),
    [inventory],
  );

  const onTargetsWritten = useCallback(
    (events: ScenarioWriteEvent[], label: string) => {
      const removed = new Set<SolverMutationKey>();
      for (const e of events) {
        const item = e.targetId ? itemByTarget.get(`${e.targetKind}:${e.targetId}`) : undefined;
        const target: DraftTarget = { kind: e.targetKind, id: e.targetId, ...item?.draftRef };
        for (const m of draftMutationsTargeting(mutations, target)) removed.add(mutationKey(m));
      }
      if (removed.size === 0) return;
      clearMutations([...removed]);
      setNotice(`Your unsaved Solver changes to ${label} were replaced by this edit.`);
    },
    [itemByTarget, mutations, clearMutations],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { notice, dismissNotice, onTargetsWritten };
}
