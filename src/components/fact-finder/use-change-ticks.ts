"use client";
// src/components/fact-finder/use-change-ticks.ts
// The change list's ticks: which fields the save will write. They start from
// the review's defaults and are kept in sessionStorage under the import and the
// review's version, so leaving the list (or reloading) keeps them while the
// fact finder is unchanged, and a new review starts over. Storage is read
// through useSyncExternalStore, whose server snapshot is "nothing stored", so
// the server and the first client render agree; when the browser refuses
// storage the ticks are held in memory only.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { defaultTicks, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";

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

export function useChangeTicks(importId: string, changeSet: ChangeSet | undefined): ChangeTicksStore {
  const key = changeSet ? `fact-finder-ticks:${importId}:${changeSet.builtAtVersion}` : null;
  // The raw string is the snapshot: equal strings are the same snapshot, so React re-renders only on a change.
  const raw = useSyncExternalStore(noSubscription, () => (key ? readStored(key) : null), () => null);
  const stored = useMemo(() => mergeTicks(raw, changeSet ? defaultTicks(changeSet) : {}), [raw, changeSet]);
  const [edited, setEdited] = useState<{ key: string; ticks: ChangeTicks } | null>(null);
  const ticks = (edited && edited.key === key ? edited.ticks : null) ?? stored;

  // The toggles read the latest ticks through a ref, so their identity never changes and a tick re-renders only its own line.
  const latest = useRef({ key, ticks });
  useEffect(() => {
    latest.current = { key, ticks };
  });

  const setLine = useCallback((lineId: string, change: (line: Record<string, boolean>) => Record<string, boolean>) => {
    const { key, ticks } = latest.current;
    const line = ticks[lineId];
    if (!key || !line) return;
    const next = { ...ticks, [lineId]: change(line) };
    latest.current = { key, ticks: next };
    setEdited({ key, ticks: next });
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Unavailable: held in memory for as long as the screen is open.
    }
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
