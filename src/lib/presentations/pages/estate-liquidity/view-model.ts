// Estate Liquidity drill — mirrors the in-app Liquidity tab (with-portfolio
// surplus). Adapter over buildYearlyLiquidityReport.

import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { DrillColumn, DrillPageData, DrillRow } from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import {
  ESTATE_DISCLAIMER, deriveOwnerInfo, estateCallout, type EstateDrillInput,
} from "../estate-shared";

export function buildEstateLiquidityDrillData(input: EstateDrillInput): DrillPageData {
  const { projection, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const { ownerNames, ownerDobs } = deriveOwnerInfo(clientData, clientName, spouseName);

  const report = buildYearlyLiquidityReport({
    projection: { years: projection.years }, clientData, ownerNames, ownerDobs,
  });

  const visibleYears = filterYearsToRange(projection.years, clientData, options.range as RangeOption);
  const visibleSet = new Set(visibleYears.map((y) => y.year));
  const reportRows = report.rows.filter((r) => visibleSet.has(r.year));

  const columns: DrillColumn[] = [
    { key: "insuranceInEstate",     header: "Insurance\nIn Estate",     width: 56 },
    { key: "insuranceOutOfEstate",  header: "Insurance\nOut of Estate", width: 56 },
    { key: "totalInsuranceBenefit", header: "Total\nInsurance",         width: 56 },
    { key: "totalPortfolioAssets",  header: "Portfolio\nAssets",        width: 56 },
    { key: "totalTransferCost",     header: "Transfer\nCost",           width: 56 },
    { key: "surplusDeficit",        header: "Surplus /\nDeficit",       width: 64, strong: true, signColor: true },
  ];

  const rows: DrillRow[] = reportRows.map((r) => ({
    year: r.year,
    ageClient: r.ageClient,
    ageSpouse: r.ageSpouse,
    cells: {
      insuranceInEstate: r.insuranceInEstate,
      insuranceOutOfEstate: r.insuranceOutOfEstate,
      totalInsuranceBenefit: r.totalInsuranceBenefit,
      totalPortfolioAssets: r.totalPortfolioAssets,
      totalTransferCost: r.totalTransferCost,
      surplusDeficit: r.surplusDeficitWithPortfolio,
    },
  }));

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const chartSpec = buildDrillChartSpec({
    years: reportRows.map((r) => r.year),
    stacks: [
      { seriesId: "totalPortfolioAssets",  label: "Portfolio Assets",  color: "#2563eb", values: reportRows.map((r) => r.totalPortfolioAssets) },
      { seriesId: "totalInsuranceBenefit", label: "Insurance Benefit", color: "#16a34a", values: reportRows.map((r) => r.totalInsuranceBenefit) },
    ],
    lines: [
      { seriesId: "totalTransferCost", label: "Transfer Cost", color: "#dc2626", values: reportRows.map((r) => r.totalTransferCost) },
    ],
    markers,
  });

  return {
    title: "Estate Liquidity",
    subtitle: scenarioLabel,
    callout: estateCallout(options, "Liquidity shown assuming both die in that year (hypothetical)."),
    chartSpec,
    table: { columns, rows, markers },
    footnote: ESTATE_DISCLAIMER,
  };
}
