// Estate Transfer (Year-by-Year) drill — mirrors the in-app Estate Transfer
// "Year-by-Year" sub-tab. Adapter over buildYearlyEstateReport: maps rows to
// DrillPageData. Death ordering defaults to whoever dies first in the plan.

import { dataLight } from "@/brand";
import {
  buildYearlyEstateReport,
} from "@/lib/estate/yearly-estate-report";
import type { DrillColumn, DrillPageData, DrillRow } from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import {
  ESTATE_DISCLAIMER, deriveOwnerInfo, estateCallout, naturalOrdering,
  type EstateDrillInput,
} from "../estate-shared";

export function buildEstateTransferDrillData(input: EstateDrillInput): DrillPageData {
  const { projection, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const { ownerNames, ownerDobs } = deriveOwnerInfo(clientData, clientName, spouseName);
  const ordering = naturalOrdering(projection);

  const report = buildYearlyEstateReport({
    projection, clientData, ordering, ownerNames, ownerDobs,
  });

  const visibleYears = filterYearsToRange(projection.years, options.range as RangeOption);
  const visibleSet = new Set(visibleYears.map((y) => y.year));
  const reportRows = report.rows.filter((r) => visibleSet.has(r.year));

  const columns: DrillColumn[] = [
    { key: "grossEstate",      header: "Gross\nEstate",       width: 60 },
    { key: "taxesAndExpenses", header: "Taxes &\nExpenses",   width: 56 },
    { key: "totalToHeirs",     header: "To\nHeirs",           width: 64, strong: true },
  ];

  const rows: DrillRow[] = reportRows.map((r) => ({
    year: r.year,
    ageClient: r.ageClient,
    ageSpouse: r.ageSpouse,
    cells: {
      grossEstate: r.grossEstate,
      taxesAndExpenses: r.taxesAndExpenses,
      totalToHeirs: r.totalToHeirs,
    },
  }));

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: reportRows.map((r) => r.year),
    stacks: [
      { seriesId: "netToHeirs",         label: "To Heirs",            color: dataLight.green, values: reportRows.map((r) => r.netToHeirs) },
      { seriesId: "taxesAndExpenses",   label: "Taxes & Expenses",    color: dataLight.red, values: reportRows.map((r) => r.taxesAndExpenses) },
      { seriesId: "charitableBequests", label: "Charitable Bequests", color: dataLight.yellow, values: reportRows.map((r) => r.charitableBequests) },
    ],
    markers,
  });

  const decedentName = ordering === "spouseFirst" ? (spouseName ?? "Spouse") : clientName;

  return {
    title: "Estate Transfer",
    subtitle: scenarioLabel,
    callout: estateCallout(options),
    chartSpec,
    table: { columns, rows, markers },
    footnote: ESTATE_DISCLAIMER,
  };
}
