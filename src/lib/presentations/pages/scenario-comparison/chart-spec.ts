import type { ChartSpec } from "@/lib/presentations/charts/types";
import { niceAxisMax, axisTicks, bandLabelIndices } from "@/lib/presentations/charts/axis";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { compactCurrency } from "@/lib/presentations/format";

export interface ComparisonSeries {
  label: string;
  color: string;
  /** Liquid portfolio total per year, index-aligned with `years`. A NON-FINITE
   *  entry is a GAP, not a value — see the note on `buildComparisonChartSpec`. */
  values: number[];
  retirementYear: number;
}

/**
 * A pure line chart expressed in the existing ChartSpec shape: no stacks, one
 * line per column. The PDF renderer already draws `lines` with an empty
 * `stacks` array, so this needs no new chart primitive.
 *
 * GAP CONTRACT — read before rendering. Two plans can run to different end
 * years, so the x domain is the union and a plan that stops early has no value
 * for the later years. Those entries are `NaN`, never 0: a zero would draw a
 * cliff to the axis that the plan does not have. `ChartSpec` has no
 * `defined`/null channel, so `NaN` is the only signal available, and the
 * renderer MUST break the polyline on a non-finite value rather than emit
 * `x,NaN` into the points string.
 */
export function buildComparisonChartSpec(
  years: number[],
  series: ComparisonSeries[],
  width: number,
  height: number,
): ChartSpec {
  // Gaps must not poison the axis maximum.
  const finite = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const yDomainMax = niceAxisMax(Math.max(0, ...finite) * 1.05);
  const yTicks = axisTicks(yDomainMax);

  // Label at most ~8 years, always including the last, and never two labels
  // close enough to print as one run of digits.
  const every = Math.max(1, Math.ceil(years.length / 8));
  const xTicks = bandLabelIndices(years.length, { every, minGap: 2 })
    .map((i) => years[i])
    .filter((y): y is number => y !== undefined);

  // One marker per DISTINCT retirement year. Emitting one per column stacks
  // identical dashed rules on the same x whenever scenarios share a retirement
  // year — which most of them do, since most scenarios change something else.
  const markers: ChartSpec["markers"] = [];
  const seenYears = new Set<number>();
  for (const s of series) {
    if (seenYears.has(s.retirementYear)) continue;
    seenYears.add(s.retirementYear);
    markers.push({
      atX: s.retirementYear,
      // The first is the household's retirement; a second distinct year only
      // exists because one scenario moved it, so it is named for that column.
      label: markers.length === 0 ? "Retirement" : s.label,
      color: s.color,
      iconKind: "retirement",
    });
  }

  return {
    kind: "stackedBarWithLine",
    width,
    height,
    margin: { top: 8, right: 10, bottom: 22, left: 44 },
    xAxis: { domain: years, ticks: xTicks, labelFormat: (v: number) => String(v) },
    yAxis: {
      domain: [0, yDomainMax],
      ticks: yTicks,
      labelFormat: (v: number) => compactCurrency(v),
      gridlineColor: T.hair,
    },
    stacks: [],
    lines: series.map((s, i) => ({
      seriesId: `col${i}`,
      label: s.label,
      color: s.color,
      // Base Case is the reference and is drawn thinner than the alternatives.
      strokeWidth: i === 0 ? 1.2 : 1.8,
      values: s.values,
    })),
    markers,
    legend: {
      position: "bottom",
      items: series.map((s) => ({ label: s.label, color: s.color, kind: "line" as const })),
    },
  };
}
