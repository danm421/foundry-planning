// Income drill-down view-model. Mirrors the Level-1 Income drill in the
// in-app Cash Flow report (cashflow-report.tsx ≈ line 1525): columns for
// Salaries, Social Security, Business, Trust, Deferred, Capital Gains,
// Other, plus a bold Total.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn,
  DrillPageData,
  DrillPageOptions,
  DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// Color palette mirrors components/cashflow/charts/income-chart.tsx so the
// PDF chart matches the on-screen chart byte-for-byte.
const INCOME_SERIES: Array<{
  key: string;
  label: string;
  color: string;
  pick: (y: ProjectionYear) => number;
}> = [
  { key: "salaries",        label: "Salaries",        color: "#16a34a", pick: (y) => y.income.salaries },
  { key: "socialSecurity",  label: "Social Security", color: "#2563eb", pick: (y) => y.income.socialSecurity },
  { key: "business",        label: "Business",        color: "#0891b2", pick: (y) => y.income.business },
  { key: "trust",           label: "Trust",           color: "#7c3aed", pick: (y) => y.income.trust },
  { key: "deferred",        label: "Deferred",        color: "#ea580c", pick: (y) => y.income.deferred },
  { key: "capitalGains",    label: "Capital Gains",   color: "#facc15", pick: (y) => y.income.capitalGains },
  { key: "other",           label: "Other",           color: "#99f6e4", pick: (y) => y.income.other },
];

// Two-line headers so narrow columns wrap cleanly at the right boundary
// instead of getting chopped mid-word by react-pdf.
const HEADERS: Record<string, string> = {
  salaries:       "Salaries",
  socialSecurity: "Social\nSecurity",
  business:       "Business",
  trust:          "Trust",
  deferred:       "Deferred",
  capitalGains:   "Capital\nGains",
  other:          "Other",
};

export interface BuildIncomeDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildIncomeDrillData(input: BuildIncomeDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  // Mirror cashflow-report's all-zero filter: drop a series if every year of
  // the full projection rounds to $0 (use `years`, not `visibleYears`, so the
  // column set is stable across slider moves).
  const activeSeries = INCOME_SERIES.filter((s) =>
    years.some((y) => Math.abs(s.pick(y)) >= 0.5),
  );

  // ── Columns ──────────────────────────────────────────────────────────────
  const dataColumns: DrillColumn[] = activeSeries.map((s) => ({
    key: s.key,
    header: HEADERS[s.key] ?? s.label,
    width: 50,
  }));
  const columns: DrillColumn[] = [
    ...dataColumns,
    { key: "total", header: "Total", width: 56, strong: true },
  ];

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const s of activeSeries) cells[s.key] = s.pick(py);
    cells.total = py.income.total;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  // ── Chart ────────────────────────────────────────────────────────────────
  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const stacks = activeSeries.map((s) => ({
    seriesId: s.key,
    label: s.label,
    color: s.color,
    values: visibleYears.map((y) => s.pick(y)),
  }));
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks,
    markers,
  });

  return {
    title: "Income",
    subtitle: scenarioLabel,
    callout: computeCallout(options),
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

function computeCallout(options: DrillPageOptions): string | undefined {
  if (!options.showCallout) return undefined;
  if (options.calloutText != null) return options.calloutText;
  if (options.range === "retirement") return "Income begins at Retirement.";
  return undefined;
}
