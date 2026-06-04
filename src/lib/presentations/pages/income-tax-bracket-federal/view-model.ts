// Tax Bracket (Federal) drill — mirrors the in-app Tax Bracket / Federal table.
// Reuses buildTaxBracketRows from the tax lib. Table-only.

import type { ProjectionYear, ClientData } from "@/engine/types";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { PRESENTATION_THEME } from "../../theme";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export interface BuildTaxBracketFederalDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxBracketFederalDrillData(input: BuildTaxBracketFederalDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);
  const bracketRows = buildTaxBracketRows(visibleYears);

  const columns: DrillColumn[] = [
    { key: "conversionGross",    header: "Roth\nConversion",      width: 52 },
    { key: "conversionTaxable",  header: "Taxable\nConversion",   width: 56 },
    { key: "incomeTaxBase",      header: "Income\nTax Base",      width: 52 },
    { key: "marginalRate",       header: "Marginal\nRate",        width: 46, format: "percent" },
    { key: "intoBracket",        header: "Into\nBracket",         width: 50 },
    { key: "remainingInBracket", header: "Remaining\nin Bracket", width: 56 },
    { key: "changeInBase",       header: "Change\nin Base",       width: 52, signColor: true },
  ];

  const rows: DrillRow[] = bracketRows.map((br) => ({
    year: br.year,
    ageClient: br.clientAge ?? null,
    ageSpouse: br.spouseAge ?? null,
    cells: {
      conversionGross:    br.conversionGross,
      conversionTaxable:  br.conversionTaxable,
      incomeTaxBase:      br.incomeTaxBase,
      marginalRate:       br.marginalRate,
      intoBracket:        br.intoBracket,
      remainingInBracket: br.remainingInBracket ?? 0,
      changeInBase:       br.changeInBase,
    },
  }));

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: [
      {
        seriesId: "intoBracket", label: "Into Bracket",
        color: PRESENTATION_THEME.accent,
        values: bracketRows.map((br) => br.intoBracket),
      },
      {
        seriesId: "remainingInBracket", label: "Remaining in Bracket",
        color: PRESENTATION_THEME.hair,
        values: bracketRows.map((br) => br.remainingInBracket ?? 0),
      },
    ],
    lines: [{
      seriesId: "conversionTaxable", label: "Taxable Conversion",
      color: PRESENTATION_THEME.steel,
      values: bracketRows.map((br) => br.conversionTaxable),
    }],
    markers,
  });

  return {
    title: "Income Tax — Tax Bracket (Federal)",
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
