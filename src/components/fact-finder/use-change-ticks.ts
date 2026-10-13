"use client";
// src/components/fact-finder/use-change-ticks.ts
// The change list's ticks: which fields the save will write. They start from
// the review's defaults and are kept in sessionStorage under the import and the
// review's version, so leaving the list (or reloading) keeps them while the
// fact finder is unchanged, and a new review starts over. Storage is read
// through useSyncExternalStore, whose server snapshot is "nothing stored", so
// the server and the first client render agree; when the browser refuses
// storage the ticks are held in memory only.
import { useMemo, useState, useSyncExternalStore } from "react";
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

function parseTicks(raw: string | null): ChangeTicks | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ChangeTicks) : null;
  } catch {
    return null;
  }
}

export function useChangeTicks(importId: string, changeSet: ChangeSet | undefined): ChangeTicksStore {
  const key = changeSet ? `fact-finder-ticks:${importId}:${changeSet.builtAtVersion}` : null;
  // The raw string is the snapshot: equal strings are the same snapshot, so React re-renders only on a change.
  const raw = useSyncExternalStore(noSubscription, () => (key ? readStored(key) : null), () => null);
  const stored = useMemo(() => parseTicks(raw), [raw]);
  const defaults = useMemo(() => (changeSet ? defaultTicks(changeSet) : {}), [changeSet]);
  const [edited, setEdited] = useState<{ key: string; ticks: ChangeTicks } | null>(null);
  const ticks = (edited && edited.key === key ? edited.ticks : null) ?? stored ?? defaults;

  function setLine(lineId: string, change: (line: Record<string, boolean>) => Record<string, boolean>) {
    const line = ticks[lineId];
    if (!key || !line) return;
    const next = { ...ticks, [lineId]: change(line) };
    setEdited({ key, ticks: next });
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Unavailable: held in memory for as long as the screen is open.
    }
  }

  return {
    ticks,
    toggleField: (lineId, fieldKey) => setLine(lineId, (line) => ({ ...line, [fieldKey]: !line[fieldKey] })),
    toggleLine: (lineId) =>
      setLine(lineId, (line) => {
        const on = !Object.values(line).every(Boolean);
        return Object.fromEntries(Object.keys(line).map((k) => [k, on]));
      }),
  };
}
