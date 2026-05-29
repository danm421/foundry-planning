// Other Taxes drill — the "Other ▸" group from the Federal tab: the taxes
// beyond regular federal income tax. Their sum equals the Federal page's
// "Other" column (= totalTax − regularFederalIncomeTax). Table-only.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

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

  const columns: DrillColumn[] = [
    { key: "capitalGainsTax",    header: "Capital\nGains Tax",  width: 52 },
    { key: "amt",                header: "AMT",                 width: 40 },
    { key: "niit",               header: "NIIT",                width: 40 },
    { key: "additionalMedicare", header: "Add'l\nMedicare",     width: 50 },
    { key: "fica",               header: "FICA",                width: 44 },
    { key: "stateTax",           header: "State\nTax",          width: 48 },
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
      total: (f?.totalTax ?? 0) - (f?.regularFederalIncomeTax ?? 0),
    };
    return { year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null, cells };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  return {
    title: "Income Tax — Other Taxes",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "Other taxes shown from Retirement."),
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
