// Below-Line Deductions drill — the "Below-Line Deduct ▸" group from the
// Federal tab: itemized components, the itemized total, the standard deduction,
// and the deduction actually taken (taxDeductions = max). Table-only.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export interface BuildTaxBelowLineDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxBelowLineDrillData(input: BuildTaxBelowLineDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  const columns: DrillColumn[] = [
    { key: "charitable",     header: "Charitable",       width: 48 },
    { key: "taxesPaid",      header: "Taxes Paid\n(SALT)", width: 52 },
    { key: "propertyTaxes",  header: "Property",         width: 46 },
    { key: "interestPaid",   header: "Interest",         width: 46 },
    { key: "otherItemized",  header: "Other\nItemized",  width: 48 },
    { key: "itemizedTotal",  header: "Itemized\nTotal",  width: 50 },
    { key: "standard",       header: "Standard",         width: 48 },
    { key: "deductionTaken", header: "Deduction\nTaken", width: 56, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const b = py.deductionBreakdown?.belowLine;
    return {
      year: py.year, ageClient: py.ages.client ?? null, ageSpouse: py.ages.spouse ?? null,
      cells: {
        charitable: b?.charitable ?? 0,
        taxesPaid: b?.taxesPaid ?? 0,
        propertyTaxes: b?.propertyTaxes ?? 0,
        interestPaid: b?.interestPaid ?? 0,
        otherItemized: b?.otherItemized ?? 0,
        itemizedTotal: b?.itemizedTotal ?? 0,
        standard: b?.standardDeduction ?? 0,
        deductionTaken: b?.taxDeductions ?? 0,
      },
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  return {
    title: "Income Tax — Below-Line Deductions",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "Below-line deductions shown from Retirement."),
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
