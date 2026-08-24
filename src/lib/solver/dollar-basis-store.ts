"use client";

import { useSyncExternalStore } from "react";
import type { DollarBasis } from "./monthly-cash-flow";

const KEY = "foundry:solver:dollarBasis";
const DEFAULT: DollarBasis = "today";

// A tiny external store backed by localStorage, read through
// useSyncExternalStore. This keeps the remembered basis working without a mount
// effect (which would trip react-hooks/set-state-in-effect) and without an SSR
// hydration mismatch — the server snapshot is the default and the client
// reconciles to the stored value after hydration. Mirrors the chart-height
// store in solver-chart-panel.tsx.
let cached: DollarBasis | null = null;
const listeners = new Set<() => void>();

function readStored(): DollarBasis {
  try {
    return window.localStorage.getItem(KEY) === "nominal" ? "nominal" : DEFAULT;
  } catch {
    // localStorage unavailable (private mode) — fall through to the default.
    return DEFAULT;
  }
}

function getSnapshot(): DollarBasis {
  if (cached === null) cached = readStored();
  return cached;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setDollarBasis(next: DollarBasis): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // localStorage unavailable — keep the in-memory value only.
  }
  for (const listener of listeners) listener();
}

/** The remembered today's-dollars / future-dollars choice, and a setter that
 *  persists it. The setter is module-level and therefore already stable. */
export function useDollarBasis(): [DollarBasis, (next: DollarBasis) => void] {
  const basis = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT);
  return [basis, setDollarBasis];
}
