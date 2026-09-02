import type { BetterIs, MetricCell, MetricRow } from "./types";
import { fmtPct, fmtSignedPts, fmtSignedUsd, fmtUsdCompact } from "./format";

/** One column's already-read figures. Every field is plain data: the view
 *  model does the bundle reads, this module does the arithmetic. `null` means
 *  the figure was unavailable (a failed Monte Carlo, an estate-less household)
 *  and must print as an em-dash rather than as zero. */
export interface ScenarioColumnInput {
  refKey: string;
  name: string;
  successRate: number | null;      // 0..1
  endingP20: number | null;
  atRetirement: number;
  atEndOfLife: number;
  retirementYear: number;
  endYear: number;
  lifetimeTaxTotal: number;
  lifetimeTaxFederal: number;
  lifetimeTaxState: number;
  yearsFullyFunded: number;
  netToHeirs: number | null;
  maxSpendToday: number | null;
}

export interface MetricRowsInput {
  /** Index 0 is always Base Case. */
  columns: ScenarioColumnInput[];
  showMaxSpend: boolean;
}

type Read = (c: ScenarioColumnInput) => number | null;

interface RowSpec {
  label: string;
  indent: boolean;
  betterIs: BetterIs;
  read: Read;
  fmt: (v: number) => string;
  /** Percent rows round each side first, so a printed delta can never
   *  contradict the two printed percentages. */
  fmtDelta: (base: number, col: number) => string;
  /** Row is omitted entirely when this returns false for the whole column set. */
  include?: (cols: ScenarioColumnInput[]) => boolean;
}

const usdDelta = (base: number, col: number) => fmtSignedUsd(col - base);
const countDelta = (base: number, col: number) =>
  `${col - base >= 0 ? "+" : "−"}${Math.abs(col - base)}`;

function rowSpecs(showMaxSpend: boolean): RowSpec[] {
  return [
    { label: "Plan confidence", indent: false, betterIs: "higher",
      read: (c) => c.successRate, fmt: (v) => fmtPct(v),
      fmtDelta: (b, c) => fmtSignedPts(b, c) },
    { label: "Max sustainable spending", indent: false, betterIs: "higher",
      read: (c) => c.maxSpendToday, fmt: fmtUsdCompact, fmtDelta: usdDelta,
      include: () => showMaxSpend },
    { label: "Assets at retirement", indent: false, betterIs: "higher",
      read: (c) => c.atRetirement, fmt: fmtUsdCompact, fmtDelta: usdDelta },
    { label: "Assets end of life", indent: false, betterIs: "higher",
      read: (c) => c.atEndOfLife, fmt: fmtUsdCompact, fmtDelta: usdDelta },
    { label: "Downside ending (20th pct)", indent: false, betterIs: "higher",
      read: (c) => c.endingP20, fmt: fmtUsdCompact, fmtDelta: usdDelta },
    { label: "Lifetime taxes — total", indent: false, betterIs: "lower",
      read: (c) => c.lifetimeTaxTotal, fmt: fmtUsdCompact, fmtDelta: usdDelta },
    { label: "federal", indent: true, betterIs: "lower",
      read: (c) => c.lifetimeTaxFederal, fmt: fmtUsdCompact, fmtDelta: usdDelta },
    { label: "state", indent: true, betterIs: "lower",
      read: (c) => c.lifetimeTaxState, fmt: fmtUsdCompact, fmtDelta: usdDelta,
      // A household in a no-income-tax state would otherwise get a row of $0s.
      include: (cols) => cols.some((c) => c.lifetimeTaxState > 0) },
    { label: "Years fully funded", indent: false, betterIs: "higher",
      read: (c) => c.yearsFullyFunded, fmt: (v) => String(v), fmtDelta: countDelta },
    { label: "Net to heirs", indent: false, betterIs: "higher",
      read: (c) => c.netToHeirs, fmt: fmtUsdCompact, fmtDelta: usdDelta,
      include: (cols) => cols.some((c) => c.netToHeirs != null) },
  ];
}

/** Index of the best column, or -1 when nothing is comparable. Ties go to the
 *  leftmost column, which means Base Case wins a tie — the current plan is not
 *  beaten by a scenario that merely matches it. */
function bestIndex(values: Array<number | null>, betterIs: BetterIs): number {
  if (betterIs === "neutral") return -1;
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (best === -1) { best = i; continue; }
    const cur = values[best]!;
    if (betterIs === "higher" ? v > cur : v < cur) best = i;
  }
  return best;
}

export function buildMetricRows(input: MetricRowsInput): MetricRow[] {
  const { columns, showMaxSpend } = input;

  return rowSpecs(showMaxSpend)
    .filter((spec) => (spec.include ? spec.include(columns) : true))
    .map((spec) => {
      const values = columns.map(spec.read);
      const best = bestIndex(values, spec.betterIs);
      const baseValue = values[0];

      const cells: MetricCell[] = values.map((v, i) => {
        const value = v == null ? "—" : spec.fmt(v);
        // No delta on the base column, and none when either side is missing —
        // a delta against an em-dash would be a fabricated number.
        if (i === 0 || v == null || baseValue == null) {
          return { value, delta: null, direction: 0, isBest: i === best };
        }
        const raw = v - baseValue;
        // Direction comes from betterIs, NOT from the sign of `raw`. A lower
        // lifetime tax is a gain and must print in the success colour.
        const direction: 1 | -1 | 0 =
          raw === 0 || spec.betterIs === "neutral"
            ? 0
            : (spec.betterIs === "higher") === (raw > 0) ? 1 : -1;
        return {
          value,
          delta: spec.fmtDelta(baseValue, v),
          direction,
          isBest: i === best,
        };
      });

      return { label: spec.label, indent: spec.indent, betterIs: spec.betterIs, cells };
    });
}
