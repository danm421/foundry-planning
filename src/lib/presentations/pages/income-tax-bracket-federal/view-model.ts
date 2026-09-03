// Tax Bracket (Federal) drill — mirrors the in-app Tax Bracket / Federal table.
// Reuses buildTaxBracketRows from the tax lib. Table-only.

import type { ProjectionYear, ClientData } from "@/engine/types";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { clipRowsToYears, emptyRangeNote, filterYearsToRange } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { PRESENTATION_THEME } from "../../theme";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

/** Naming every year of a long AMT spell would run the 7pt footnote off the
 *  page, so the list is capped — visibly, with a count, never silently. */
const FOOTNOTE_YEAR_CAP = 6;

/**
 * A client keeps this page, and it prints Marginal Rate and Remaining in
 * Bracket immediately beside a Roth Conversion column. In a year the
 * alternative minimum tax binds, neither of those describes the price of the
 * next dollar — so the page has to say which years those are. Named, not
 * asterisked: there is no hover on paper.
 */
function amtFootnote(rows: { year: number; amtApplies: boolean }[]): string {
  const years = rows.filter((r) => r.amtApplies).map((r) => r.year);
  if (years.length === 0) return "";

  const shown = years.slice(0, FOOTNOTE_YEAR_CAP);
  const hidden = years.length - shown.length;
  const joined =
    shown.length === 1
      ? String(shown[0])
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  const list = hidden > 0 ? `${joined}, plus ${hidden} more` : joined;
  const one = years.length === 1;

  return (
    `AMT applies in the following ${one ? "year" : "years"}: ${list}. In ${one ? "that year" : "those years"} ` +
    `the next dollar of income is taxed at the AMT rate rather than the marginal rate shown, and no bracket ` +
    `headroom is available at that rate — Remaining in Bracket is reported as zero. `
  );
}

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
  const visibleYears = filterYearsToRange(years, options.range);
  const bracketRows = clipRowsToYears(buildTaxBracketRows(years), visibleYears);

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
    years: bracketRows.map((br) => br.year),
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
    chartSpec: rows.length > 0 ? chartSpec : undefined,
    table: { columns, rows, markers },
    footnote: emptyRangeNote(options.range, rows.length) + amtFootnote(bracketRows) + DISCLAIMER,
  };
}

function computeCallout(options: DrillPageOptions): string | undefined {
  if (!options.showCallout) return undefined;
  return options.calloutText ?? undefined;
}
