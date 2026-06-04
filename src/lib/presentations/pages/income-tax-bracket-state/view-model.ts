// Tax Bracket (State) drill — mirrors the in-app Tax Bracket / State table.
// Reuses buildStateBracketRows from the tax lib (extracted in Task 1). When the
// residence state has no income tax, buildStateBracketRows yields rows with a 0
// marginal rate, or no rows at all — the table simply renders what it gets.

import type { ProjectionYear, ClientData } from "@/engine/types";
import { buildStateBracketRows } from "@/lib/tax/bracket";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { PRESENTATION_THEME } from "../../theme";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export interface BuildTaxBracketStateDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxBracketStateDrillData(input: BuildTaxBracketStateDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);
  const stateRows = buildStateBracketRows(visibleYears);

  const columns: DrillColumn[] = [
    { key: "stateTaxable",       header: "State\nTaxable",        width: 52 },
    { key: "marginalRate",       header: "Marginal\nRate",        width: 46, format: "percent" },
    { key: "intoBracket",        header: "Into\nBracket",         width: 50 },
    { key: "remainingInBracket", header: "Remaining\nin Bracket", width: 56 },
    { key: "stateTax",           header: "State\nTax",            width: 50, strong: true },
    { key: "changeInBase",       header: "Change\nin Base",       width: 52, signColor: true },
  ];

  const rows: DrillRow[] = stateRows.map((sr) => ({
    year: sr.year,
    ageClient: sr.clientAge ?? null,
    ageSpouse: sr.spouseAge ?? null,
    cells: {
      stateTaxable: sr.stateTaxableIncome,
      marginalRate: sr.marginalRate,
      intoBracket: sr.intoBracket,
      remainingInBracket: sr.remainingInBracket ?? 0,
      stateTax: sr.stateTax,
      changeInBase: sr.changeInBase,
    },
  }));

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  const chartSpec = buildDrillChartSpec({
    years: stateRows.map((sr) => sr.year),
    stacks: [
      {
        seriesId: "intoBracket", label: "Into Bracket",
        color: PRESENTATION_THEME.accent,
        values: stateRows.map((sr) => sr.intoBracket),
      },
      {
        seriesId: "remainingInBracket", label: "Remaining in Bracket",
        color: PRESENTATION_THEME.hair,
        values: stateRows.map((sr) => sr.remainingInBracket ?? 0),
      },
    ],
    markers,
  });

  return {
    title: "Income Tax — Tax Bracket (State)",
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
