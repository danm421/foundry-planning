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
import { dataLight } from "@/brand";

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
  { key: "salaries",        label: "Salaries",        color: dataLight.green,  pick: (y) => y.income.salaries },
  { key: "socialSecurity",  label: "Social Security", color: dataLight.blue,   pick: (y) => y.income.socialSecurity },
  { key: "business",        label: "Business",        color: dataLight.teal,   pick: (y) => y.income.business },
  { key: "trust",           label: "Trust",           color: dataLight.purple, pick: (y) => y.income.trust },
  { key: "deferred",        label: "Deferred",        color: dataLight.orange, pick: (y) => y.income.deferred },
  { key: "capitalGains",    label: "Capital Gains",   color: dataLight.yellow, pick: (y) => y.income.capitalGains },
  { key: "other",           label: "Other",           color: dataLight.grey,   pick: (y) => y.income.other },
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
    // F80: use the canonical reconciling field (projection.ts:4593), which folds
    // householdRmdIncome + householdNoteCashIn on top of income.total. The drill
    // has no RMD/notes breakdown columns, so this Total intentionally exceeds the
    // visible column sum — matching the main Cash Flow page's Total Income.
    cells.total = py.totalIncome;
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
