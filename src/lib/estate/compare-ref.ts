//
// URL contract for the estate report compare mode.
//
//   ?scenario=<ref>  → left column  (absent → the base case)
//   ?compare=<ref>   → right column (absent → solo mode, one column)
//
// Ref grammar matches `parsePlansToken` in
// src/lib/scenario/scenario-from-search-params.ts: "base" | "<scenarioId>" |
// "snap:<snapshotId>". Snapshot refs are recognized but not servable — the
// projection-data route takes a scenario id and has no snapshot path — so they
// resolve to solo mode with `unsupportedRight` set for the caller to surface.
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";
import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";

export const BASE_REF = "base";

const SNAPSHOT_PREFIX = "snap:";

export interface CompareSelection {
  /** Left column ref. Always present; the base case when ?scenario= is absent. */
  left: string;
  /** Right column ref, or null in solo mode. */
  right: string | null;
  /** True when ?compare= named a ref this feature cannot render. */
  unsupportedRight: boolean;
}

/**
 * `useSearchParams()` returns null when there is no router context (it does in
 * jsdom tests), so the param bag is nullable by design.
 */
export function readCompareSelection(
  params: { get(k: string): string | null } | null,
): CompareSelection {
  const left = params?.get("scenario") || BASE_REF;
  const rawRight = params?.get("compare") || null;
  if (rawRight === null) {
    return { left, right: null, unsupportedRight: false };
  }
  if (rawRight.startsWith(SNAPSHOT_PREFIX)) {
    return { left, right: null, unsupportedRight: true };
  }
  return { left, right: rawRight, unsupportedRight: false };
}

export function refLabel(ref: string, scenarios: ScenarioOption[]): string {
  if (ref === BASE_REF) {
    return scenarios.find((s) => s.isBaseCase)?.name ?? "Base case";
  }
  return scenarios.find((s) => s.id === ref)?.name ?? "Unknown scenario";
}

// ── Shared as-of, per-side years ────────────────────────────────────────────
//
// The compare control row stores the advisor's SEMANTIC choice, never a bare
// year. A scenario can move the projected death years, so "Last Death" must
// mean 2061 on the left and 2059 on the right. Storing the resolved year would
// silently pin both columns to whichever column resolved it first.

export type CompareAsOf =
  | { kind: "today" }
  | { kind: "split" }
  | { kind: "milestone"; milestone: "retirement" | "firstDeath" | "lastDeath" }
  | { kind: "year"; year: number };

export interface ColumnYears {
  todayYear: number;
  retirementYear: number;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

/** Resolve the shared selection into the `AsOfValue` one column should render. */
export function resolveCompareAsOf(
  sel: CompareAsOf,
  years: ColumnYears,
): AsOfValue {
  if (sel.kind === "today") return "today";
  if (sel.kind === "split") return "split";
  if (sel.kind === "year") return sel.year;
  if (sel.milestone === "retirement") return years.retirementYear;
  if (sel.milestone === "firstDeath") {
    return years.firstDeathYear ?? "today";
  }
  // lastDeath: the second death when there is one, else the only death, else today.
  return years.secondDeathYear ?? years.firstDeathYear ?? "today";
}
