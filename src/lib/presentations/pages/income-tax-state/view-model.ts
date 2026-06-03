// State Tax drill — mirrors the in-app "State" tab. Subtractions are shown
// inline (SS / Retirement / Cap Gains); there is no separate state drill page.
// Chart: a single State Tax bar series per year.
//
// Effective rate = stateTax / startingIncome, matching tax-detail-state-table.tsx.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn, DrillPageData, DrillPageOptions, DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { dataLight } from "@/brand";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export interface BuildTaxStateDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildTaxStateDrillData(input: BuildTaxStateDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  const columns: DrillColumn[] = [
    { key: "federalBase",  header: "Federal\nBase",   width: 48 },
    { key: "addBacks",     header: "Add-\nBacks",     width: 42 },
    { key: "ssSub",        header: "SS\nSub",         width: 38 },
    { key: "retireSub",    header: "Retire\nSub",     width: 42 },
    { key: "cgSub",        header: "CG\nSub",         width: 38 },
    { key: "stateAGI",     header: "State\nAGI",      width: 46 },
    { key: "stdDed",       header: "Std\nDed",        width: 40 },
    { key: "exemption",    header: "Exemption",       width: 46 },
    { key: "stateTaxable", header: "State\nTaxable",  width: 48 },
    { key: "stateTax",     header: "State\nTax",      width: 48, strong: true },
    { key: "effRate",      header: "Eff\nRate",       width: 40, format: "percent" },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const s = py.taxResult?.state;
    const starting = s?.startingIncome ?? 0;
    const cells: Record<string, number> = {
      federalBase:  starting,
      addBacks:     s?.addbacks.total ?? 0,
      ssSub:        s?.subtractions.socialSecurity ?? 0,
      retireSub:    s?.subtractions.retirementIncome ?? 0,
      cgSub:        s?.subtractions.capitalGains ?? 0,
      stateAGI:     s?.stateAGI ?? 0,
      stdDed:       s?.stdDeduction ?? 0,
      exemption:    s?.personalExemptionDeduction ?? 0,
      stateTaxable: s?.stateTaxableIncome ?? 0,
      stateTax:     s?.stateTax ?? 0,
      effRate:      starting > 0 ? (s?.stateTax ?? 0) / starting : 0,
    };
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: [{
      seriesId: "stateTax",
      label: "State Tax",
      color: dataLight.blue,
      values: visibleYears.map((y) => y.taxResult?.state?.stateTax ?? 0),
    }],
    markers,
  });

  return {
    title: "Income Tax — State",
    subtitle: scenarioLabel,
    callout: computeCallout(options, "State tax detail begins at Retirement."),
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
