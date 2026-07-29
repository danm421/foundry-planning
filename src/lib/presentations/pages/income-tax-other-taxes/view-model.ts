// Other Taxes drill — the "Other ▸" group from the Federal tab: everything in
// Total Tax beyond regular federal income tax. Mostly taxes, plus one NEGATIVE
// component (federal credits, netted inside totalTax while regularFederalIncomeTax
// stays pre-credit). The named columns SUM to the Total column, which equals the
// Federal page's "Other" (= totalTax − regularFederalIncomeTax). Table-only.

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

/** Federal credits as they land in the Other bucket — always ≤ 0.
 *
 *  SIGN. `otherTaxFromFlow` = totalTax − regularFederalIncomeTax, and
 *  `regularFederalIncomeTax` stays PRE-credit by design (calculate.ts). Expanding
 *  the roll-up (calculate.ts: totalFederalTax = max(0, subpartA − nonrefundable)
 *  + NIIT + addl Medicare − refundable, where subpartA = regularFed + capGains +
 *  AMT) gives
 *
 *      other = capGains + AMT + NIIT + addlMedicare + state + FICA + penalty
 *              − (taxCredits + refundableCredits)
 *
 *  so the named columns OVERSHOOT the total by exactly the credit dollars, and
 *  the column that closes the gap must be NEGATIVE. `flow.taxCredits` is already
 *  the APPLIED nonrefundable figure — credits.ts clamps each component against
 *  remaining tax, so it can never exceed subpartA and the roll-up's `Math.max(0,…)`
 *  is a no-op. That is why no second clamp is needed here. */
const creditsInOther = (f: TaxFlow | undefined) =>
  -((f?.taxCredits ?? 0) + (f?.refundableCredits ?? 0));

/** Chart stack for credits. A negative series is SAFE here: build-chart-spec
 *  tracks positive and negative stack subtotals separately and opens a diverging
 *  y-domain, and the renderer's `stackRects` stacks negative segments downward
 *  from zero (see chart-geom.ts — Portfolio Activity already relies on it). So
 *  credits render as a below-axis segment rather than a broken bar, and the
 *  stack still sums to the Other total. */
const CREDITS_STACK = {
  key: "credits", label: "Federal Credits", color: dataLight.blue, pick: creditsInOther,
};

/** True when any visible year applied a federal credit. */
function hasCreditYear(years: ProjectionYear[]): boolean {
  return years.some((y) => creditsInOther(y.taxResult?.flow) !== 0);
}

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
  const visibleYears = filterYearsToRange(years, options.range as RangeOption);

  // Zero-suppress the early-withdrawal penalty: it only appears in years with a
  // pre-59½ draw, so hide both the column and the chart series when no visible
  // year has one. When present, it must be a component so the columns/stack sum
  // to the Other total (= totalTax − regularFed, which already includes it).
  const showPenalty = hasPenaltyYear(visibleYears);

  // Same zero-suppression for federal credits (Task 14b / D2). Credits are netted
  // inside totalTax while regularFederalIncomeTax stays pre-credit, so they land
  // entirely in the Other bucket; without this column the named columns overshoot
  // `total` by the credit dollars and the page contradicts its own header comment.
  const showCredits = hasCreditYear(visibleYears);

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
    ...(showCredits
      ? [{ key: "credits", header: "Federal\nCredits", width: 50 }]
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
      credits:            creditsInOther(f),
      total: otherTaxFromFlow(f),
    };
    return { year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null, cells };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  const stackDefs = [
    ...OTHER_STACK,
    ...(showPenalty ? [PENALTY_STACK] : []),
    ...(showCredits ? [CREDITS_STACK] : []),
  ];
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
