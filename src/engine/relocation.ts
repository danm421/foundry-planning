import type { USPSStateCode } from "@/lib/usps-states";
import type { Relocation } from "./types";

/**
 * Resolve the household's residence state for a given year.
 *
 * Step function: among enabled relocations whose `year <= year`, the one with
 * the latest year wins (ties broken by later array position — relocations
 * arrive in order_index order, so a later-authored move overrides an earlier
 * same-year one). If none apply, the base (initial) state is returned.
 *
 * Pure + framework-free. Used by the income-tax seam in projection.ts and the
 * estate-tax seams in the death-event engine.
 */
export function resolveResidenceState(
  baseState: USPSStateCode | null,
  relocations: Relocation[] | undefined,
  year: number,
): USPSStateCode | null {
  let chosen = baseState;
  let chosenYear = -Infinity;
  for (const r of relocations ?? []) {
    if (r.enabled === false || r.year > year) continue;
    if (r.year >= chosenYear) {
      chosen = r.destinationState;
      chosenYear = r.year;
    }
  }
  return chosen;
}
