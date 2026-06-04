// Above-Line Deductions drill — the "Above-Line Deduct ▸" group from the
// Federal tab, broken into its components. Table-only (no chart).

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

type AboveLine = NonNullable<ProjectionYear["deductionBreakdown"]>["aboveLine"];
const ABOVE_STACK: Array<{ key: string; label: string; color: string; pick: (a: AboveLine | undefined) => number }> = [
  { key: "retirementContributions", label: "Retirement Contributions", color: dataLight.blue, pick: (a) => a?.retirementContributions ?? 0 },
  { key: "taggedExpenses",          label: "Tagged Expenses",          color: dataLight.green, pick: (a) => a?.taggedExpenses ?? 0 },
  { key: "manualEntries",           label: "Manual Entries",           color: dataLight.orange, pick: (a) => a?.manualEntries ?? 0 },
];

export interface BuildTaxAboveLineDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxAboveLineDrillData(input: BuildTaxAboveLineDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, options.range as RangeOption);

  const columns: DrillColumn[] = [
    { key: "retirementContributions", header: "Retirement\nContributions", width: 64 },
    { key: "taggedExpenses",          header: "Tagged\nExpenses",          width: 56 },
    { key: "manualEntries",           header: "Manual\nEntries",           width: 56 },
    { key: "total",                   header: "Total",                     width: 56, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const a = py.deductionBreakdown?.aboveLine;
    return {
      year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null,
      cells: {
        retirementContributions: a?.retirementContributions ?? 0,
        taggedExpenses: a?.taggedExpenses ?? 0,
        manualEntries: a?.manualEntries ?? 0,
        total: a?.total ?? 0,
      },
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: ABOVE_STACK.map((s) => ({
      seriesId: s.key, label: s.label, color: s.color,
      values: visibleYears.map((y) => s.pick(y.deductionBreakdown?.aboveLine)),
    })),
    markers,
  });

  return {
    title: "Income Tax — Above-Line Deductions",
    subtitle: scenarioLabel,
    callout: computeCallout(options),
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

function computeCallout(options: DrillPageOptions): string | undefined {
  if (!options.showCallout) return undefined;
  return options.calloutText ?? undefined;
}
