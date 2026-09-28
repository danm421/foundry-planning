// Tax Bracket (Federal) drill — mirrors the in-app Tax Bracket / Federal table
// and its chart. Reuses buildTaxBracketRows and the bracket-fill model from
// the tax lib, so the sheet draws the same bars over the same floors as the
// solver and the income-tax page.

import type { ProjectionYear, ClientData } from "@/engine/types";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import {
  bracketFloorSeries,
  bracketRateLabel,
  buildBracketFillModel,
} from "@/lib/tax/bracket-fill";
import { bracketFloorColor, dataPalette } from "@/lib/chart-palette";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { clipRowsToYears, emptyRangeNote, filterYearsToRange } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";

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

  // The income tax base as a bar — other income, then the taxable Roth
  // conversion on top — over one line per federal bracket floor. The chart is
  // built from the rows the table prints, so the two agree year for year.
  //
  // The axis ceiling is the screen chart's (just above the tallest filled
  // tier's top, so the room left in the bracket shows). A floor is drawn only
  // while it is under that ceiling: the canvas clips a line that climbs off
  // the top, but a PDF polyline has no clip, and one 37% floor left running
  // to $2M by the plan's last year dragged the axis to $2.5M and pressed the
  // bars into the bottom sixth of the sheet.
  const fill = buildBracketFillModel(visibleYears);
  const palette = dataPalette("light");
  const chartSpec = buildDrillChartSpec({
    years: fill.years.map((y) => y.year),
    yMax: fill.yMax,
    stacks: [
      {
        seriesId: "incomeBase", label: "Income tax base",
        color: palette.blue,
        values: fill.years.map((y) => y.otherIncome),
      },
      {
        // "Roth conversion", not "Taxable Roth conversion": the longer name
        // overran its 7pt legend slot into the next swatch. The Taxable
        // Conversion column below is where the distinction is made.
        seriesId: "conversion", label: "Roth conversion",
        color: palette.orange,
        values: fill.years.map((y) => y.conversion),
      },
    ],
    lines: bracketFloorSeries(fill).map((f) => ({
      seriesId: `floor-${f.rate}`,
      label: `${bracketRateLabel(f.rate)} floor`,
      color: bracketFloorColor(f.rank, "light"),
      strokeWidth: 1,
      values: f.values.map((v) => (v < fill.yMax ? v : NaN)),
    })),
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
