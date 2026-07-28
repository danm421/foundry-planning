import type { ProjectionYear } from "@/engine/types";
import type { TaxYearParameters } from "@/lib/tax/types";
import {
  THRESHOLD_ITEMS,
  isNaRange,
  rangeFor,
  statusFor,
  type ThresholdFacts,
  type ThresholdHousehold,
  type ThresholdItemId,
  type ThresholdStatus,
} from "@/lib/tax/thresholds";

/**
 * One row of the Thresholds report: a `THRESHOLD_ITEMS` entry compared across
 * the live scenario ("Alternative") and the base plan ("Original") for one
 * projection year.
 */
export interface ThresholdReportRow {
  id: ThresholdItemId;
  label: string;
  thresholdDisplay: string;
  alternativeStatus: ThresholdStatus;
  originalStatus: ThresholdStatus;
}

/** U+2014 EM DASH — the report's "no computable range" glyph, distinct from
 *  the ASCII hyphen used inside a two-ended range string. */
const EM_DASH = "—";

/** `Math.round` — the AMT exemption end and the QBI end are computed off
 *  seeded params and can be fractional; the report never shows cents. */
function formatDollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Renders the shared Threshold column for one item. Driven ONLY by the
 * `household` argument, never by a per-projection `thresholdFacts.household`
 * — the column is one cell shared by both the Alternative and Original rows,
 * so it needs exactly one household to describe, and it must still render
 * when `scenarioFacts` (bracket-mode `thresholdFacts`) is absent.
 *
 * `scenarioFacts` is consulted for exactly one item: `charitableLimit`, whose
 * `rangeFor` range is `{ start: 0.6, end: null }` — a FRACTION of AGI, not a
 * dollar threshold. The 60% is read off `range.start` rather than hardcoded
 * so this stays in sync if the statute ever changes, and it is multiplied by
 * the scenario's AGI (there being no AGI to take 60% of when bracket mode
 * hasn't run) before falling into the generic formatting below, which would
 * otherwise render the fraction as "$1".
 */
function formatThresholdDisplay(
  id: ThresholdItemId,
  year: number,
  params: TaxYearParameters,
  household: ThresholdHousehold,
  scenarioFacts: Omit<ThresholdFacts, "params"> | undefined,
): string {
  const range = rangeFor(id, year, params, household.filingStatus, household);

  if (id === "charitableLimit") {
    return scenarioFacts == null ? EM_DASH : formatDollars(range.start * scenarioFacts.agi);
  }

  if (isNaRange(range)) return EM_DASH;
  if (range.end == null) return formatDollars(range.start);
  return `${formatDollars(range.start)} - ${formatDollars(range.end)}`;
}

/**
 * Builds the 11-row Thresholds report comparing one year's Alternative (live
 * scenario) and Original (base plan) projections. Always emits all 11
 * `THRESHOLD_ITEMS` rows, in that order, and never filters: a row that
 * doesn't apply to this household still shows its range in the Threshold
 * column and "na" in both status columns — that is what keeps the report a
 * fixed checklist rather than a list that reflows per household.
 *
 * `ProjectionYear.thresholdFacts` omits `params` (the report already holds
 * one `TaxYearParameters` shared by both projections — the same tax year),
 * so each side's full `ThresholdFacts` is rebuilt here before calling
 * `statusFor`. Each side keeps its OWN `thresholdFacts.household` for that
 * call — never the `household` argument, which drives the Threshold column
 * only. `thresholdFacts` is populated in bracket mode only, so either side's
 * status column being "na" across the board (flat mode, or no matching base
 * year) is a live production path, not a defensive fallback.
 */
export function buildThresholdReport(input: {
  year: number;
  scenario: ProjectionYear;
  base: ProjectionYear | undefined;
  params: TaxYearParameters;
  household: ThresholdHousehold;
}): ThresholdReportRow[] {
  const { year, scenario, base, params, household } = input;

  const alternativeFacts: ThresholdFacts | undefined = scenario.thresholdFacts
    ? { ...scenario.thresholdFacts, params }
    : undefined;
  const originalFacts: ThresholdFacts | undefined = base?.thresholdFacts
    ? { ...base.thresholdFacts, params }
    : undefined;

  return THRESHOLD_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    thresholdDisplay: formatThresholdDisplay(item.id, year, params, household, scenario.thresholdFacts),
    alternativeStatus: alternativeFacts ? statusFor(item.id, alternativeFacts) : "na",
    originalStatus: originalFacts ? statusFor(item.id, originalFacts) : "na",
  }));
}
