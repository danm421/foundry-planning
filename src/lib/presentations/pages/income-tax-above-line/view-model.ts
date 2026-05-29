// Above-Line Deductions drill — the "Above-Line Deduct ▸" group from the
// Federal tab, broken into its components. Table-only (no chart).

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

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
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

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
  return {
    title: "Income Tax — Above-Line Deductions",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "Above-line deductions shown from Retirement."),
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
