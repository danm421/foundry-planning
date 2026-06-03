// Other Taxes drill — the "Other ▸" group from the Federal tab: the taxes
// beyond regular federal income tax. Their sum equals the Federal page's
// "Other" column (= totalTax − regularFederalIncomeTax). Table-only.

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
const OTHER_STACK: Array<{ key: string; label: string; color: string; pick: (f: TaxFlow | undefined) => number }> = [
  { key: "capitalGainsTax",    label: "Capital Gains", color: dataLight.yellow, pick: (f) => f?.capitalGainsTax ?? 0 },
  { key: "amt",                label: "AMT",           color: dataLight.purple, pick: (f) => f?.amtAdditional ?? 0 },
  { key: "niit",               label: "NIIT",          color: dataLight.teal, pick: (f) => f?.niit ?? 0 },
  { key: "additionalMedicare", label: "Add'l Medicare", color: dataLight.orange, pick: (f) => f?.additionalMedicare ?? 0 },
  { key: "fica",               label: "FICA",          color: dataLight.green, pick: (f) => f?.fica ?? 0 },
  { key: "stateTax",           label: "State Tax",     color: dataLight.grey, pick: (f) => f?.stateTax ?? 0 },
];

export interface BuildTaxOtherTaxesDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxOtherTaxesDrillData(input: BuildTaxOtherTaxesDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  // Zero-suppress the early-withdrawal penalty: it only appears in years with a
  // pre-59½ draw, so hide both the column and the chart series when no visible
  // year has one. When present, it must be a component so the columns/stack sum
  // to the Other total (= totalTax − regularFed, which already includes it).
  const showPenalty = hasPenaltyYear(visibleYears);

  const columns: DrillColumn[] = [
    { key: "capitalGainsTax",    header: "Capital\nGains Tax",  width: 52 },
    { key: "amt",                header: "AMT",                 width: 40 },
    { key: "niit",               header: "NIIT",                width: 40 },
    { key: "additionalMedicare", header: "Add'l\nMedicare",     width: 50 },
    { key: "fica",               header: "FICA",                width: 44 },
    { key: "stateTax",           header: "State\nTax",          width: 48 },
    ...(showPenalty
      ? [{ key: "earlyWithdrawalPenalty", header: "Early\nWithdrawal", width: 52 }]
      : []),
    { key: "total",              header: "Total",               width: 50, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const f = py.taxResult?.flow;
    const cells: Record<string, number> = {
      capitalGainsTax:    f?.capitalGainsTax    ?? 0,
      amt:                f?.amtAdditional      ?? 0,
      niit:               f?.niit               ?? 0,
      additionalMedicare: f?.additionalMedicare  ?? 0,
      fica:               f?.fica               ?? 0,
      stateTax:           f?.stateTax           ?? 0,
      earlyWithdrawalPenalty: f?.earlyWithdrawalPenalty ?? 0,
      total: otherTaxFromFlow(f),
    };
    return { year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null, cells };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  const stackDefs = showPenalty ? [...OTHER_STACK, PENALTY_STACK] : OTHER_STACK;
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: stackDefs.map((s) => ({
      seriesId: s.key, label: s.label, color: s.color,
      values: visibleYears.map((y) => s.pick(y.taxResult?.flow)),
    })),
    markers,
  });

  return {
    title: "Income Tax — Other Taxes",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "Other taxes shown from Retirement."),
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
