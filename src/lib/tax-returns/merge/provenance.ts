import type { OverrideMap } from "./types";

/**
 * Field path → source. Derived on every read from the documents plus the
 * override map, never stored: a stored provenance map goes stale the moment a
 * document is removed, which is the exact failure this layer exists to avoid.
 */
export function deriveProvenance(
  mergeProvenance: Record<string, string>,
  overrides: OverrideMap,
): Record<string, string> {
  const out: Record<string, string> = { ...mergeProvenance };
  for (const path of Object.keys(overrides)) out[path] = "advisor";
  return out;
}
