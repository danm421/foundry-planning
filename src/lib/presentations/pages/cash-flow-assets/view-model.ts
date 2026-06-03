// Portfolio Assets drill-down view-model. Mirrors the Level-1 "portfolio"
// drill in cashflow-report.tsx: the liquid investable columns (Taxable, Cash,
// Retirement, Life Insurance, and — when present — Accessible Trust Assets)
// subtotal to the canonical Total Portfolio (= engine portfolioAssets.liquidTotal,
// H1), then Trusts & Businesses and Real Estate add to the informational grand
// Total Assets. Chart mirrors the in-app portfolio chart — stacked bars by
// category, same colors as components/cashflow/charts/portfolio-chart.tsx.

import type { ProjectionYear, ClientData } from "@/engine/types";
import type {
  DrillColumn,
  DrillPageData,
  DrillPageOptions,
  DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";
import { dataLight } from "@/brand";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// Chart palette — matches buildPortfolioDatasets() in
// components/cashflow/charts/portfolio-chart.tsx. Also reused by the Portfolio
// Growth drill (cash-flow-growth/view-model.ts).
export const STACK_COLORS = {
  cash:                 dataLight.grey,
  taxable:              dataLight.yellow,
  retirement:           dataLight.orange,
  lifeInsurance:        dataLight.green,
  realEstate:           dataLight.teal,
  business:             dataLight.purple,
  trustsAndBusinesses:  dataLight.blue,
  accessibleTrustAssets: dataLight.pink,
} as const;

export interface BuildPortfolioAssetsDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildPortfolioAssetsDrillData(
  input: BuildPortfolioAssetsDrillInput,
): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  const hasAnyAccessible = years.some(
    (y) => Math.abs(y.portfolioAssets.accessibleTrustAssetsTotal) >= 0.5,
  );

  // H1: canonical Total Portfolio = engine liquidTotal (taxable + cash +
  // retirement + lifeInsurance + accessibleTrustAssets). The accessible-trust
  // column therefore sits *among* the liquid buckets and feeds this subtotal.
  const liquidTotal = (y: ProjectionYear) => y.portfolioAssets.liquidTotal;

  // Informational grand total. trustsAndBusinessesTotal already mirrors any
  // household-owned business-category accounts, so we add it (not businessTotal)
  // to avoid double-counting; this preserves the original Total Assets value.
  const grandTotal = (y: ProjectionYear) =>
    liquidTotal(y) +
    y.portfolioAssets.trustsAndBusinessesTotal +
    y.portfolioAssets.realEstateTotal;

  // ── Columns ──────────────────────────────────────────────────────────────
  // Liquid buckets (incl. optional Accessible Trusts) → Total Portfolio (bold,
  // = liquidTotal) → Trusts & Businesses → Real Estate → Total Assets (bold).
  const columns: DrillColumn[] = [
    { key: "taxable",       header: "Taxable",       width: 38 },
    { key: "cash",          header: "Cash",          width: 38 },
    { key: "retirement",    header: "Retirement",    width: 42 },
    { key: "lifeInsurance", header: "Life\nInsurance", width: 42 },
    ...(hasAnyAccessible
      ? [{ key: "accessible", header: "Accessible\nTrusts", width: 48 } as DrillColumn]
      : []),
    { key: "liquidTotal",   header: "Total\nPortfolio", width: 50, strong: true },
    { key: "trusts",        header: "Trusts &\nBusinesses", width: 50 },
    { key: "realEstate",    header: "Real\nEstate",   width: 42 },
    { key: "grandTotal",    header: "Total\nAssets",  width: 54, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {
      taxable:       py.portfolioAssets.taxableTotal,
      cash:          py.portfolioAssets.cashTotal,
      retirement:    py.portfolioAssets.retirementTotal,
      lifeInsurance: py.portfolioAssets.lifeInsuranceTotal,
      liquidTotal:   liquidTotal(py),
      trusts:        py.portfolioAssets.trustsAndBusinessesTotal,
      realEstate:    py.portfolioAssets.realEstateTotal,
      grandTotal:    grandTotal(py),
    };
    if (hasAnyAccessible) cells.accessible = py.portfolioAssets.accessibleTrustAssetsTotal;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  // ── Chart ────────────────────────────────────────────────────────────────
  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  // Stack order: bottom→top = Cash, Taxable, Retirement, Life Insurance,
  // Real Estate, Business, Trusts & Businesses, Accessible Trust Assets.
  const stackDefs: Array<{ key: string; label: string; color: string; pick: (y: ProjectionYear) => number }> = [
    { key: "cash",                   label: "Cash",                   color: STACK_COLORS.cash,                  pick: (y) => y.portfolioAssets.cashTotal },
    { key: "taxable",                label: "Taxable",                color: STACK_COLORS.taxable,               pick: (y) => y.portfolioAssets.taxableTotal },
    { key: "retirement",             label: "Retirement",             color: STACK_COLORS.retirement,            pick: (y) => y.portfolioAssets.retirementTotal },
    { key: "lifeInsurance",          label: "Life Insurance",         color: STACK_COLORS.lifeInsurance,         pick: (y) => y.portfolioAssets.lifeInsuranceTotal },
    { key: "realEstate",             label: "Real Estate",            color: STACK_COLORS.realEstate,            pick: (y) => y.portfolioAssets.realEstateTotal },
    { key: "business",               label: "Business",               color: STACK_COLORS.business,              pick: (y) => y.portfolioAssets.businessTotal },
    { key: "trustsAndBusinesses",    label: "Trusts & Businesses",    color: STACK_COLORS.trustsAndBusinesses,   pick: (y) => y.portfolioAssets.trustsAndBusinessesTotal },
    { key: "accessibleTrustAssets",  label: "Accessible Trust Assets", color: STACK_COLORS.accessibleTrustAssets, pick: (y) => y.portfolioAssets.accessibleTrustAssetsTotal },
  ];
  const activeStacks = stackDefs
    .filter((s) => years.some((y) => Math.abs(s.pick(y)) >= 0.5))
    .map((s) => ({
      seriesId: `assets:${s.key}`,
      label: s.label,
      color: s.color,
      values: visibleYears.map((y) => s.pick(y)),
    }));

  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks: activeStacks,
    markers,
  });

  return {
    title: "Portfolio Assets",
    subtitle: scenarioLabel,
    callout: computeCallout(options),
    chartSpec,
    table: { columns, rows, markers },
    footnote: DISCLAIMER,
  };
}

function computeCallout(options: DrillPageOptions): string | undefined {
  if (!options.showCallout) return undefined;
  if (options.calloutText != null) return options.calloutText;
  return undefined;
}
