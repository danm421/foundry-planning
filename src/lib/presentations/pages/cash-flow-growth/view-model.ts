// Portfolio Growth drill-down view-model. Mirrors the Level-1 "growth" drill
// in cashflow-report.tsx ≈ line 1905: investment growth grouped by asset
// category (Taxable, Cash, Retirement, Real Estate, Business, Life Insurance)
// plus a bold Total. The in-app report has no chart for this drill, so we
// leave chartSpec undefined.

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
import { STACK_COLORS } from "../cash-flow-assets/view-model";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// portfolioAssets bucket key → display label + column key. Same order as in
// the in-app drill.
const CATEGORIES: Array<{
  bucket: keyof ProjectionYear["portfolioAssets"];
  key: string;
  label: string;
}> = [
  { bucket: "taxable",       key: "taxable",       label: "Taxable" },
  { bucket: "cash",          key: "cash",          label: "Cash" },
  { bucket: "retirement",    key: "retirement",    label: "Retirement" },
  { bucket: "realEstate",    key: "realEstate",    label: "Real\nEstate" },
  { bucket: "business",      key: "business",      label: "Business" },
  { bucket: "lifeInsurance", key: "lifeInsurance", label: "Life\nInsurance" },
];

export interface BuildPortfolioGrowthDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildPortfolioGrowthDrillData(
  input: BuildPortfolioGrowthDrillInput,
): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  function growthByCategorySegment(r: ProjectionYear, bucket: keyof ProjectionYear["portfolioAssets"]): number {
    const byAcct = r.portfolioAssets[bucket] as Record<string, number> | undefined;
    if (!byAcct) return 0;
    let sum = 0;
    for (const id of Object.keys(byAcct)) sum += r.accountLedgers[id]?.growth ?? 0;
    return sum;
  }

  function portfolioAccountIds(r: ProjectionYear): Set<string> {
    const ids = new Set<string>();
    for (const cat of CATEGORIES) {
      const byAcct = r.portfolioAssets[cat.bucket] as Record<string, number> | undefined;
      if (byAcct) for (const id of Object.keys(byAcct)) ids.add(id);
    }
    return ids;
  }

  function portfolioGrowthTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += r.accountLedgers[id]?.growth ?? 0;
    return sum;
  }

  const activeCats = CATEGORIES.filter((c) =>
    years.some((y) => Math.abs(growthByCategorySegment(y, c.bucket)) >= 0.5),
  );

  const dataColumns: DrillColumn[] = activeCats.map((c) => ({
    key: c.key,
    header: c.label,
    width: 60,
  }));
  const columns: DrillColumn[] = [
    ...dataColumns,
    { key: "total", header: "Total", width: 64, strong: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const c of activeCats) cells[c.key] = growthByCategorySegment(py, c.bucket);
    cells.total = portfolioGrowthTotal(py);
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
    stacks: activeCats.map((c) => ({
      seriesId: c.key,
      label: c.label.replace("\n", " "),
      color: STACK_COLORS[c.key as keyof typeof STACK_COLORS] ?? "#9ca3af",
      values: visibleYears.map((y) => growthByCategorySegment(y, c.bucket)),
    })),
    markers,
  });

  return {
    title: "Portfolio Growth",
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
