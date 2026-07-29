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
  /**
   * `charitableLimit` ONLY — undefined for every other row.
   *
   * That row's ceiling is 60% of AGI, and the two sides have their own AGI, so
   * one shared Threshold cell can only ever describe one of them. The rule
   * ("60% of AGI") is what both sides genuinely share and stays in
   * `thresholdDisplay`; the two computed ceilings live here, one per side.
   * They render in the Alternative/Original columns, whose status cells carry
   * no signal for this row anyway — `statusFor("charitableLimit")` returns
   * "full" unconditionally (thresholds.ts:260).
   */
  alternativeThresholdDisplay?: string;
  originalThresholdDisplay?: string;
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
 * so it needs exactly one household to describe, and it must still render when
 * neither side has bracket-mode `thresholdFacts`. It therefore takes no facts
 * at all: everything AGI-dependent is per-side (see `formatAgiShare`).
 *
 * `charitableLimit` is the one item this renders as a RULE rather than a
 * figure: its `rangeFor` range is `{ start: 0.6, end: null }` — a FRACTION of
 * AGI, which the generic formatting below would render as "$1". The dollar
 * ceilings it implies are per-side (see `alternativeThresholdDisplay`), so
 * what belongs in this shared cell is the rule itself. The 60% is read off
 * `range.start` rather than hardcoded, so it stays in sync if the statute ever
 * changes.
 */
function formatThresholdDisplay(
  id: ThresholdItemId,
  year: number,
  params: TaxYearParameters,
  household: ThresholdHousehold,
): string {
  const range = rangeFor(id, year, params, household.filingStatus, household);

  if (id === "charitableLimit") {
    // `Number(toFixed(2))`: 0.6 * 100 is exactly 60 today, but a future
    // statutory fraction (0.3 * 100 -> 30.000000000000004) would print float
    // noise into an advisor-facing cell. A genuine 57.5% survives intact.
    return `${Number((range.start * 100).toFixed(2))}% of AGI`;
  }

  if (isNaRange(range)) return EM_DASH;
  if (range.end == null) return formatDollars(range.start);
  return `${formatDollars(range.start)} - ${formatDollars(range.end)}`;
}

/**
 * One side's `charitableLimit` dollar ceiling — `share` (0.6) times that
 * side's own AGI.
 *
 * EM_DASH when the side has no facts at all (flat mode, or no matching base
 * year) OR when its AGI is <= 0. A negative AGI is a correct and load-bearing
 * engine result in a big-loss year, and nothing here clamps it — but "60% of
 * negative" is not a ceiling an advisor can act on, and printing "$-180,000"
 * (or "$0") in a limit column reads as a real limit. This is DISPLAY only.
 */
function formatAgiShare(share: number, facts: Omit<ThresholdFacts, "params"> | undefined): string {
  if (facts == null || facts.agi <= 0) return EM_DASH;
  return formatDollars(share * facts.agi);
}

/**
 * Builds the 11-row Thresholds report comparing one year's Alternative (live
 * scenario) and Original (base plan) projections. Always emits all 11
 * `THRESHOLD_ITEMS` rows, in that order, and never filters: a row that
 * doesn't apply to this household still shows its range in the Threshold
 * column and "na" in both status columns — that is what keeps the report a
 * fixed checklist rather than a list that reflows per household.
 * `charitableLimit` is the one row whose two side columns carry dollar
 * ceilings instead of statuses (see `alternativeThresholdDisplay`).
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

  return THRESHOLD_ITEMS.map((item) => {
    const row: ThresholdReportRow = {
      id: item.id,
      label: item.label,
      thresholdDisplay: formatThresholdDisplay(item.id, year, params, household),
      alternativeStatus: alternativeFacts ? statusFor(item.id, alternativeFacts) : "na",
      originalStatus: originalFacts ? statusFor(item.id, originalFacts) : "na",
    };

    if (item.id === "charitableLimit") {
      const share = rangeFor(item.id, year, params, household.filingStatus, household).start;
      row.alternativeThresholdDisplay = formatAgiShare(share, scenario.thresholdFacts);
      row.originalThresholdDisplay = formatAgiShare(share, base?.thresholdFacts);
    }

    return row;
  });
}
