"use client";

// Optimistic overlay for a list rendered straight from server props.
//
// `BalanceSheetView` and `InsurancePanel` hold no local row state — they render
// props and re-render via `router.refresh()`. Without an overlay every inline
// edit sits unchanged until the round-trip completes, which reads as a dead
// control. (`IncomeExpensesView` already keeps its own list state and does this
// by hand; it does not need the hook.)
//
// Reconciliation is PER FIELD, not per row, and is driven by agreement rather
// than by a timer or a props-identity check: a pending field is dropped the
// moment the incoming row carries the same value. That keeps an optimistic
// value visible across an unrelated refresh (which would otherwise flicker it
// back to the stale number) without ever stranding one forever.
import { useCallback, useEffect, useMemo, useState } from "react";

export interface PendingEdits<T> {
  /** `rows` with any pending field values merged over them. */
  rows: T[];
  /**
   * Show `patch` immediately, run `save`, and roll back if it reports failure
   * or throws. Resolves to whatever `save` resolved to (false on throw), so
   * callers can toast.
   */
  apply: (id: string, patch: Partial<T>, save: () => Promise<boolean>) => Promise<boolean>;
}

export function usePendingEdits<T extends { id: string }>(rows: T[]): PendingEdits<T> {
  const [pending, setPending] = useState<Record<string, Partial<T>>>({});

  useEffect(() => {
    // Reconciliation is a props-driven state adjustment, not an external-system
    // sync. The functional updater returns `prev` unchanged whenever nothing was
    // reconciled, so the cascading re-render the rule warns about cannot occur.
    // Restructuring this into the render-phase "adjust state when props change"
    // pattern is a change to plan-mandated code and is pending the project
    // owner's decision.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;

      let changed = false;
      const next: Record<string, Partial<T>> = {};
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) {
          changed = true;
          continue;
        }
        const kept: Partial<T> = {};
        for (const key of Object.keys(prev[id]) as (keyof T)[]) {
          if (row[key] === prev[id][key]) changed = true;
          else kept[key] = prev[id][key];
        }
        if (Object.keys(kept).length > 0) next[id] = kept;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const merged = useMemo(
    () => rows.map((r) => (pending[r.id] ? { ...r, ...pending[r.id] } : r)),
    [rows, pending],
  );

  const apply = useCallback(
    async (id: string, patch: Partial<T>, save: () => Promise<boolean>): Promise<boolean> => {
      setPending((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
      let ok = false;
      try {
        ok = await save();
      } catch {
        ok = false;
      }
      if (!ok) {
        // Drop only the keys THIS call added — a concurrent edit to another
        // field on the same row must not be reverted by our failure.
        setPending((prev) => {
          const row = prev[id];
          if (!row) return prev;
          const kept: Partial<T> = {};
          for (const key of Object.keys(row) as (keyof T)[]) {
            if (!(key in patch)) kept[key] = row[key];
          }
          const next = { ...prev };
          if (Object.keys(kept).length > 0) next[id] = kept;
          else delete next[id];
          return next;
        });
      }
      return ok;
    },
    [],
  );

  return { rows: merged, apply };
}
