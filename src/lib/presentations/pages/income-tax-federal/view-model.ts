// Federal Tax drill — mirrors the in-app "Federal" tab summary. The Above-Line,
// Below-Line, and "Other" groups appear here as single totals; their components
// live on the dedicated drill pages. Chart stacks the tax components that sum to
// Total Tax (rate stays a table column — the chart axis is dollars only).

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { otherTaxFromFlow } from "@/lib/tax/other-tax";
import { PENALTY_STACK, hasPenaltyYear } from "../../shared/penalty";
import { dataLight } from "@/brand";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

type TaxFlow = NonNullable<ProjectionYear["taxResult"]>["flow"];

// Tax components that sum to Total Tax — used for the stacked chart.
const TAX_STACK: Array<{ key: string; label: string; color: string; pick: (f: TaxFlow) => number }> = [
  { key: "regularFed",    label: "Regular Federal", color: dataLight.blue, pick: (f) => f.regularFederalIncomeTax },
  { key: "capGainsTax",   label: "Capital Gains",   color: dataLight.yellow, pick: (f) => f.capitalGainsTax },
  { key: "amt",           label: "AMT",             color: dataLight.purple, pick: (f) => f.amtAdditional },
  { key: "niit",          label: "NIIT",            color: dataLight.teal, pick: (f) => f.niit },
  { key: "additionalMed", label: "Add'l Medicare",  color: dataLight.orange, pick: (f) => f.additionalMedicare },
  { key: "fica",          label: "FICA",            color: dataLight.green, pick: (f) => f.fica },
  { key: "stateTaxStack", label: "State Tax",       color: dataLight.grey, pick: (f) => f.stateTax },
];
// PENALTY_STACK is appended (zero-suppressed) so the stacked chart still sums to
// Total Tax in penalty years. No table column: "Other" already = totalTax −
// regularFed, which includes it.

export interface BuildTaxFederalDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxFederalDrillData(input: BuildTaxFederalDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, options.range as RangeOption);

  const columns: DrillColumn[] = [
    { key: "totalIncome",   header: "Total\nIncome",      width: 48 },
    { key: "aboveLine",     header: "Above-Line\nDeduct", width: 48 },
    { key: "agi",           header: "AGI",                width: 44 },
    { key: "belowLine",     header: "Below-Line\nDeduct", width: 48 },
    { key: "qbiDeduction",  header: "QBI",                width: 36 },
    { key: "taxableIncome", header: "Taxable\nIncome",    width: 48 },
    { key: "taxBase",       header: "Tax\nBase",          width: 44 },
    { key: "regularFed",    header: "Regular\nFed",       width: 44 },
    { key: "other",         header: "Other",              width: 42 },
    { key: "totalTax",      header: "Total\nTax",         width: 48, strong: true },
    { key: "marginalRate",  header: "Marginal\nRate",     width: 44, format: "percent" },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const f = py.taxResult?.flow;
    const cells: Record<string, number> = {
      totalIncome:   py.taxResult?.income.grossTotalIncome ?? 0,
      aboveLine:     f?.aboveLineDeductions ?? 0,
      agi:           f?.adjustedGrossIncome ?? 0,
      belowLine:     f?.belowLineDeductions ?? 0,
      qbiDeduction:  f?.qbiDeduction ?? 0,
      taxableIncome: f?.taxableIncome ?? 0,
      taxBase:       f?.incomeTaxBase ?? 0,
      regularFed:    f?.regularFederalIncomeTax ?? 0,
      other:         otherTaxFromFlow(f),
      totalTax:      f?.totalTax ?? 0,
      marginalRate:  py.taxResult?.diag.marginalFederalRate ?? 0,
    };
    return { year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null, cells };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const stackDefs = hasPenaltyYear(visibleYears) ? [...TAX_STACK, PENALTY_STACK] : TAX_STACK;
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: stackDefs.map((s) => ({
      seriesId: s.key, label: s.label, color: s.color,
      values: visibleYears.map((y) => (y.taxResult ? s.pick(y.taxResult.flow) : 0)),
    })),
    markers,
  });

  return {
    title: "Income Tax — Federal",
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
