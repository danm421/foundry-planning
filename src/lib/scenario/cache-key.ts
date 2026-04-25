// src/lib/scenario/cache-key.ts
import type { ToggleState } from "@/engine/scenario/types";

/**
 * Stable, key-order-independent hash for ToggleState.
 * Used as part of cache keys for projection results.
 *
 * Implementation: sort entries by key, JSON-stringify. Cheap and good enough
 * for cache scoping — collisions don't matter since cache misses are safe.
 */
export function hashToggleState(state: ToggleState): string {
  const entries = Object.entries(state).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
