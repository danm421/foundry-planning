import type { BuildDataContext } from "@/components/presentations/registry";
import type { MonteCarloSummary } from "@/engine";
import type { HistogramSeries } from "@/lib/monte-carlo/histogram-series";
import type { MonteCarloPageOptions, MonteCarloChartKind } from "./options-schema";
import {
  buildFanChartSpec,
  buildHistogramChartSpec,
  buildSuccessChartSpec,
  type FanChartSpec,
  type HistogramChartSpec,
  type SuccessChartSpec,
} from "@/lib/presentations/charts/monte-carlo-specs";
import { compactCurrency } from "@/lib/presentations/format";
import type { DrillColumn, DrillRow } from "@/lib/presentations/shared/drill-types";
import type { TableMarker } from "@/lib/presentations/types";

/** Compact, serializable bundle the export route computes server-side and
 *  injects via BuildDataContext. Avoids serializing the raw trial matrix. */
export interface MonteCarloReportPayload {
  summary: MonteCarloSummary;
  histogram: HistogramSeries;
  successRates: number[]; // per plan-year, [0,1]
  deterministic: number[]; // liquid portfolio per plan-year
}

export interface MonteCarloPageData {
  available: boolean;
  title: string;
  subtitle: string;
  kpis: Array<{ label: string; value: string }>;
  heroKind: MonteCarloChartKind;
  fan: FanChartSpec;
  histogram: HistogramChartSpec;
  success: SuccessChartSpec;
  table: { columns: DrillColumn[]; rows: DrillRow[]; markers: TableMarker[] };
  footnote: string;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

const EMPTY_FAN: FanChartSpec = buildFanChartSpec({ byYear: [], deterministic: null, markers: [] });

export function buildMonteCarloData(
  ctx: BuildDataContext,
  options: MonteCarloPageOptions,
): MonteCarloPageData {
  const payload = ctx.monteCarlo ?? null;
  if (!payload) {
    return {
      available: false,
      title: "Monte Carlo",
      subtitle: ctx.scenarioLabel,
      kpis: [],
      heroKind: options.highlight,
      fan: EMPTY_FAN,
      histogram: buildHistogramChartSpec({
        bins: [], p5: 0, p25: 0, p50: 0, p75: 0, p95: 0,
        belowDomainCount: 0, aboveDomainCount: 0,
        sd: { mean: 0, stdDev: 0, minus2: 0, minus1: 0, plus1: 0, plus2: 0, countWithin1: 0, countWithin2: 0, countBelowMinus2: 0, countAbovePlus2: 0 },
      }),
      success: buildSuccessChartSpec({ successRates: [], years: [], ages: [] }),
      table: { columns: [], rows: [], markers: [] },
      footnote: "",
    };
  }

  const { summary } = payload;
  const client = ctx.clientData.client;

  // Markers: primary retirement year, derived from byYear ages.
  const retireRow = summary.byYear.find((r) => r.age.client === client.retirementAge);
  const markers = retireRow
    ? [{ atYear: retireRow.year, label: `Retire ${client.retirementAge}` }]
    : [];

  const fan = buildFanChartSpec({
    byYear: summary.byYear,
    deterministic: payload.deterministic.length === summary.byYear.length ? payload.deterministic : null,
    markers,
  });
  const histogram = buildHistogramChartSpec(payload.histogram);
  const success = buildSuccessChartSpec({
    successRates: payload.successRates,
    years: summary.byYear.map((r) => r.year),
    ages: summary.byYear.map((r) => r.age.client ?? null),
  });

  const kpis = [
    { label: "Probability of success", value: pct(summary.successRate) },
    { label: "Median ending value", value: compactCurrency(summary.ending.p50) },
    { label: "P5–P95 range", value: `${compactCurrency(summary.ending.p5)} – ${compactCurrency(summary.ending.p95)}` },
    { label: "Trials", value: String(summary.trialsRun) },
  ];

  // Yearly table — reuse the DrillTablePdf shape.
  const columns: DrillColumn[] = [
    { key: "p80", header: "Above\n(p80)", width: 0 },
    { key: "cagr80", header: "CAGR", width: 0, format: "percent" },
    { key: "p50", header: "Median\n(p50)", width: 0, strong: true },
    { key: "cagr50", header: "CAGR", width: 0, format: "percent" },
    { key: "p20", header: "Below\n(p20)", width: 0 },
    { key: "cagr20", header: "CAGR", width: 56, format: "percent" },
  ];
  const rows: DrillRow[] = summary.byYear.map((r) => ({
    year: r.year,
    ageClient: r.age.client ?? null,
    ageSpouse: r.age.spouse ?? null,
    cells: {
      p80: r.balance.p80,
      cagr80: r.cagrFromStart?.p80 ?? 0,
      p50: r.balance.p50,
      cagr50: r.cagrFromStart?.p50 ?? 0,
      p20: r.balance.p20,
      cagr20: r.cagrFromStart?.p20 ?? 0,
    },
  }));
  const tableMarkers: TableMarker[] = markers.map((m) => ({
    year: m.atYear,
    label: m.label,
    kind: "retirement",
    who: "client",
  }));

  return {
    available: true,
    title: "Monte Carlo",
    subtitle: `${ctx.scenarioLabel} · ${summary.trialsRun.toLocaleString("en-US")} trials`,
    kpis,
    heroKind: options.highlight,
    fan,
    histogram,
    success,
    table: { columns, rows, markers: tableMarkers },
    footnote: summary.aborted
      ? "Simulation aborted before completion; results reflect completed trials."
      : "Hypothetical projection. 1,000 trials. Not a guarantee of future results.",
  };
}
