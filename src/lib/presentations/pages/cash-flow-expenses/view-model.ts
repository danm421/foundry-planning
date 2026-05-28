// Expenses drill-down view-model. Mirrors the Level-1 Expenses drill in
// cashflow-report.tsx ≈ line 1671: Living, Surplus spent, Liabilities,
// Other, Insurance, Real Estate, Taxes, then bold Total.

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

// Column order = on-screen drill order. Chart color palette mirrors
// components/cashflow/charts/expenses-chart.tsx.
const EXPENSE_SERIES: Array<{
  key: string;
  label: string;
  color: string;
  pick: (y: ProjectionYear) => number;
}> = [
  { key: "living",        label: "Living",        color: "#16a34a", pick: (y) => y.expenses.living },
  { key: "discretionary", label: "Surplus spent", color: "#f59e0b", pick: (y) => y.expenses.discretionary },
  { key: "liabilities",   label: "Liabilities",   color: "#ef4444", pick: (y) => y.expenses.liabilities },
  { key: "other",         label: "Other",         color: "#99f6e4", pick: (y) => y.expenses.other },
  { key: "insurance",     label: "Insurance",     color: "#7c3aed", pick: (y) => y.expenses.insurance },
  { key: "realEstate",    label: "Real Estate",   color: "#0891b2", pick: (y) => y.expenses.realEstate },
  { key: "taxes",         label: "Taxes",         color: "#ea580c", pick: (y) => y.expenses.taxes },
];

const HEADERS: Record<string, string> = {
  living:        "Living",
  discretionary: "Surplus\nspent",
  liabilities:   "Liabilities",
  other:         "Other",
  insurance:     "Insurance",
  realEstate:    "Real\nEstate",
  taxes:         "Taxes",
};

export interface BuildExpensesDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildExpensesDrillData(input: BuildExpensesDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  const activeSeries = EXPENSE_SERIES.filter((s) =>
    years.some((y) => Math.abs(s.pick(y)) >= 0.5),
  );

  const dataColumns: DrillColumn[] = activeSeries.map((s) => ({
    key: s.key,
    header: HEADERS[s.key] ?? s.label,
    width: 50,
  }));
  const columns: DrillColumn[] = [
    ...dataColumns,
    { key: "total", header: "Total", width: 56, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const s of activeSeries) cells[s.key] = s.pick(py);
    cells.total = py.expenses.total;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

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
    title: "Expenses",
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
  if (options.range === "retirement") return "Expenses shown from Retirement onward.";
  return undefined;
}
