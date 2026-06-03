// Income Breakdown drill — mirrors the in-app Income Tax "Income" tab.
// Columns: Earned, Taxable SS, Ordinary, Dividends, LT/ST Cap Gains, QBI,
// Total Income, Non-Taxable, and a pinned Gross Total Income.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { dataLight } from "@/brand";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// Stacked income components (sum toward Total Income). QBI is shown as a table
// column but excluded from the stack (it is a deduction-side concept).
const SERIES: Array<{ key: string; header: string; color: string; pick: (y: ProjectionYear) => number }> = [
  { key: "earned",     header: "Earned\nIncome",   color: dataLight.green, pick: (y) => y.taxResult?.income.earnedIncome ?? 0 },
  { key: "taxableSS",  header: "Taxable\nSS",      color: dataLight.blue, pick: (y) => y.taxResult?.income.taxableSocialSecurity ?? 0 },
  { key: "ordinary",   header: "Ordinary\nIncome",  color: dataLight.teal, pick: (y) => (y.taxResult?.income.ordinaryIncome ?? 0) - (y.taxResult?.income.shortCapitalGains ?? 0) },
  { key: "dividends",  header: "Dividends",         color: dataLight.purple, pick: (y) => y.taxResult?.income.dividends ?? 0 },
  { key: "ltcg",       header: "LT Cap\nGains",    color: dataLight.yellow, pick: (y) => y.taxResult?.income.capitalGains ?? 0 },
  { key: "stcg",       header: "ST Cap\nGains",    color: dataLight.orange, pick: (y) => y.taxResult?.income.shortCapitalGains ?? 0 },
];

export interface BuildTaxIncomeDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxIncomeDrillData(input: BuildTaxIncomeDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  const columns: DrillColumn[] = [
    ...SERIES.map((s) => ({ key: s.key, header: s.header, width: 46 })),
    { key: "qbi",         header: "QBI",                 width: 40 },
    { key: "totalIncome", header: "Total\nIncome",        width: 52 },
    { key: "nonTaxable",  header: "Non-\nTaxable",        width: 46 },
    { key: "gross",       header: "Gross Total\nIncome",  width: 60, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const s of SERIES) cells[s.key] = s.pick(py);
    cells.qbi = py.taxResult?.income.qbi ?? 0;
    cells.totalIncome = py.taxResult?.income.totalIncome ?? 0;
    cells.nonTaxable = py.taxResult?.income.nonTaxableIncome ?? 0;
    cells.gross = py.taxResult?.income.grossTotalIncome ?? 0;
    return { year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null, cells };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: SERIES.map((s) => ({
      seriesId: s.key, label: s.header.replace(/\n/g, " "), color: s.color,
      values: visibleYears.map((y) => s.pick(y)),
    })),
    markers,
  });

  return {
    title: "Income Tax — Income",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "Income detail begins at Retirement."),
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

function computeCallout(options: DrillPageOptions, retirementText: string): string | undefined {
  if (!options.showCallout) return undefined;
  if (options.calloutText != null) return options.calloutText;
  if (options.range === "retirement") return retirementText;
  return undefined;
}
