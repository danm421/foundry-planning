"use client";
// src/components/fact-finder/use-change-ticks.ts
// The change list's ticks: which fields the save will write. They start from
// the review's defaults and are kept in sessionStorage under the import and the
// review's version, so leaving the list (or reloading) keeps them while the
// fact finder is unchanged. A new review of the import carries them forward to
// the list it builds (carryTicks): a field keeps a tick the advisor changed
// while its line and its new value are the same. Storage is read through useSyncExternalStore,
// whose server snapshot is "nothing stored", so the server and the first client
// render agree; when the browser refuses storage the ticks are held in memory only.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { defaultTicks, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { targetField } from "@/lib/fact-finder/placement/targets";
import { sameValue } from "@/lib/fact-finder/placement/values";

export interface ChangeTicksStore {
  /** lineId → field key → ticked; lines that are unchanged or can't save have no entry. */
  ticks: ChangeTicks;
  toggleField(lineId: string, key: string): void;
  /** Every field of the line off when all are ticked, else all on. */
  toggleLine(lineId: string): void;
}

/** Nothing outside this hook writes the key, so there's nothing to listen for. */
const noSubscription = () => () => {};

function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored ticks over the defaults: only lines and fields the change set has, only true/false — the rest keep their default. */
function mergeTicks(raw: string | null, defaults: ChangeTicks): ChangeTicks {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? "null");
  } catch {
    return defaults;
  }
  if (!isObject(stored)) return defaults;
  return Object.fromEntries(
    Object.entries(defaults).map(([lineId, line]) => {
      const kept = stored[lineId];
      if (!isObject(kept)) return [lineId, line];
      return [lineId, Object.fromEntries(Object.entries(line).map(([k, on]) => [k, typeof kept[k] === "boolean" ? kept[k] : on]))];
    }),
  );
}

/** Refs compared as the lines hold them: both lists come from the same import's reviews. */
const AS_HELD = { client: null, spouse: null };

/**
 * The ticks for `next`, a new review's list replacing `previous`, whose ticks were `ticks`: a field keeps its tick
 * when the advisor changed it (it differs from the previous list's default), its line is still the same write (create,
 * or update of the same record) and its new value is the same under the review's tolerances (sameValue); an untouched
 * field, a new or changed field, and a new line, start from the new list's default.
 */
export function carryTicks(previous: ChangeSet, ticks: ChangeTicks, next: ChangeSet): ChangeTicks {
  const before = new Map(previous.lines.map((line) => [line.id, line]));
  const carried = defaultTicks(next);
  const wasDefault = defaultTicks(previous);
  for (const line of next.lines) {
    const was = before.get(line.id);
    const kept = ticks[line.id];
    if (!carried[line.id] || !was || !kept || was.action !== line.action || was.recordId !== line.recordId) continue;
    for (const field of line.fields) {
      const old = was.fields.find((f) => f.key === field.key);
      const kind = targetField(line.target, field.key)?.kind;
      if (old && kind && typeof kept[field.key] === "boolean" && kept[field.key] !== wasDefault[line.id]?.[field.key] && sameValue(kind, old.next, field.next, AS_HELD)) {
        carried[line.id][field.key] = kept[field.key];
      }
    }
  }
  return carried;
}

const keyOf = (importId: string, changeSet: ChangeSet) => `fact-finder-ticks:${importId}:${changeSet.builtAtVersion}`;

export function useChangeTicks(importId: string, changeSet: ChangeSet | undefined): ChangeTicksStore {
  const key = changeSet ? keyOf(importId, changeSet) : null;
  // The raw string is the snapshot: equal strings are the same snapshot, so React re-renders only on a change.
  const raw = useSyncExternalStore(noSubscription, () => (key ? readStored(key) : null), () => null);
  const stored = useMemo(() => mergeTicks(raw, changeSet ? defaultTicks(changeSet) : {}), [raw, changeSet]);
  const [edited, setEdited] = useState<{ key: string; ticks: ChangeTicks } | null>(null);

  // The list the ticks were last kept for. A new review of the import replacing it, with nothing stored for it yet,
  // starts from that list's ticks carried forward — held as an edit, so it's kept like one.
  const [shown, setShown] = useState(() => (changeSet && key ? { importId, key, changeSet } : null));
  if (changeSet && key && key !== shown?.key) {
    setShown({ importId, key, changeSet });
    if (shown?.importId === importId && raw === null) {
      const before = (edited?.key === shown.key ? edited.ticks : null) ?? mergeTicks(readStored(shown.key), defaultTicks(shown.changeSet));
      setEdited({ key, ticks: carryTicks(shown.changeSet, before, changeSet) });
    }
  }
  const ticks = (edited && edited.key === key ? edited.ticks : null) ?? stored;

  // The toggles read the latest ticks through a ref, so their identity never changes and a tick re-renders only its own line.
  const latest = useRef({ key, ticks });
  useEffect(() => {
    latest.current = { key, ticks };
  });
  useEffect(() => {
    if (!edited) return;
    try {
      window.sessionStorage.setItem(edited.key, JSON.stringify(edited.ticks));
    } catch {
      // Unavailable: held in memory for as long as the screen is open.
    }
  }, [edited]);

  const setLine = useCallback((lineId: string, change: (line: Record<string, boolean>) => Record<string, boolean>) => {
    const { key, ticks } = latest.current;
    const line = ticks[lineId];
    if (!key || !line) return;
    const next = { ...ticks, [lineId]: change(line) };
    latest.current = { key, ticks: next };
    setEdited({ key, ticks: next });
  }, []);

  const toggleField = useCallback(
    (lineId: string, fieldKey: string) => setLine(lineId, (line) => ({ ...line, [fieldKey]: !line[fieldKey] })),
    [setLine],
  );
  const toggleLine = useCallback(
    (lineId: string) =>
      setLine(lineId, (line) => {
        const on = !Object.values(line).every(Boolean);
        return Object.fromEntries(Object.keys(line).map((k) => [k, on]));
      }),
    [setLine],
  );

  return { ticks, toggleField, toggleLine };
}
