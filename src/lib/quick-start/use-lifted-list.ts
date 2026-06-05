import { useCallback, useRef, useState } from "react";

export interface LiftedList<Row extends { _id: number; serverId?: string }> {
  rows: Row[];
  setRows: (updater: Row[] | ((rs: Row[]) => Row[])) => void;
  deletedServerIds: string[];
  /** Record a removed row's server id so the next save DELETEs it. */
  pushDeleted: (serverId: string | undefined) => void;
  clearDeleted: () => void;
  /** Monotonic id allocator that survives step unmount (lives in the parent). */
  makeId: () => number;
}

/**
 * Owns a list step's row state in the wizard parent so it survives the step's
 * unmount/remount during Back/Next. `seed` runs once (lazy initial state) and
 * receives the id allocator so seeded rows get stable ids.
 */
export function useLiftedList<Row extends { _id: number; serverId?: string }>(
  seed?: (makeId: () => number) => Row[],
): LiftedList<Row> {
  // One-time lazy init: seed rows with a local counter, capture the next free id.
  // This avoids passing the ref-reading `makeId` into `seed` during render,
  // which would trigger the react-hooks/refs lint rule.
  const init = useRef<{ rows: Row[]; nextId: number } | null>(null);
  if (init.current === null) {
    let n = 1;
    const seededRows = seed ? seed(() => n++) : [];
    init.current = { rows: seededRows, nextId: n };
  }
  const seeded = init.current;
  const idRef = useRef(seeded.nextId);
  const makeId = useCallback(() => idRef.current++, []);
  const [rows, setRows] = useState<Row[]>(seeded.rows);
  const [deletedServerIds, setDeleted] = useState<string[]>([]);
  const pushDeleted = useCallback((serverId: string | undefined) => {
    if (serverId) setDeleted((d) => [...d, serverId]);
  }, []);
  const clearDeleted = useCallback(() => setDeleted([]), []);
  return { rows, setRows, deletedServerIds, pushDeleted, clearDeleted, makeId };
}
