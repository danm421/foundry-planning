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
// back to the stale number) without ever stranding one forever. The agreement
// check is a structural (deep) compare, not `===` — a reference-typed field
// (e.g. an account's `owners` array) arrives from a JSON round-trip with a
// fresh identity every time, so a reference compare would never see the
// server catch up and would strand that field at its optimistic value
// permanently. See `sameFieldValue` below.
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Structural equality for a single pending field value.
 *
 * Reconciliation asks "has the server caught up with what we optimistically
 * applied?", and for a reference-typed field that question cannot be answered
 * with `===`: a JSON round-trip always returns a fresh identity, so the key
 * would never be dropped and the field would stay pinned to the optimistic
 * value forever.
 *
 * Recursive rather than shallow because `AccountOwner`
 * (src/engine/ownership.ts) is a union of objects, and its `gifted_away`
 * variant nests `recipient: { kind, id }` a further level down — a one- or
 * two-level compare would silently strand exactly that case.
 */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameFieldValue(v, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        sameFieldValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

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
    // RULING (settled, not deferred): keep this targeted suppression rather
    // than restructuring into the render-phase "adjust state when props
    // change" pattern. The restructure would be provably unobservable, not
    // merely cheaper to skip. A pending key is dropped only when the
    // incoming row's value already equals it (via `sameFieldValue`), so the
    // render before the drop and the render after it produce IDENTICAL
    // merged output — the only difference would be one extra render pass,
    // with no visual change. The row-removed branch is likewise
    // unobservable: `merged` only maps over `rows`, so a vanished row is
    // never rendered regardless of when its pending state clears.
    // Separately, the functional updater returns `prev` BY IDENTITY whenever
    // nothing reconciled (the `changed` flag stays false and
    // `return changed ? next : prev` yields `prev`), so no cascading
    // re-render occurs from this effect at all.
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
          if (sameFieldValue(row[key], prev[id][key])) changed = true;
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
