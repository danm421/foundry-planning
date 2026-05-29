// Portfolio Activity drill-down view-model. Mirrors the Level-1 "activity"
// drill in cashflow-report.tsx ≈ line 1943: Additions, Distributions, and
// Net (sign-colored). External (non-internal-transfer) only — supplemental
// withdrawal refills net out so the column means "outside money in / outside
// money out." No chart in the in-app drill, so we leave chartSpec undefined.

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
import { PRESENTATION_THEME } from "../../theme";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

const PORTFOLIO_BUCKETS = [
  "taxable", "cash", "retirement", "realEstate", "business", "lifeInsurance",
] as const;

export interface BuildPortfolioActivityDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildPortfolioActivityDrillData(
  input: BuildPortfolioActivityDrillInput,
): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  function portfolioAccountIds(r: ProjectionYear): Set<string> {
    const ids = new Set<string>();
    for (const bucket of PORTFOLIO_BUCKETS) {
      const byAcct = r.portfolioAssets[bucket] as Record<string, number> | undefined;
      if (byAcct) for (const id of Object.keys(byAcct)) ids.add(id);
    }
    return ids;
  }

  function externalContributions(r: ProjectionYear, id: string): number {
    const led = r.accountLedgers[id];
    if (!led) return 0;
    return led.contributions - (led.internalContributions ?? 0);
  }

  function externalDistributions(r: ProjectionYear, id: string): number {
    const led = r.accountLedgers[id];
    if (!led) return 0;
    return led.distributions - (led.internalDistributions ?? 0);
  }

  function additionsTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += externalContributions(r, id);
    return sum;
  }

  function distributionsTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += externalDistributions(r, id);
    return sum;
  }

  const columns: DrillColumn[] = [
    { key: "additions",     header: "Additions",     width: 120 },
    { key: "distributions", header: "Distributions", width: 120 },
    { key: "net",           header: "Net",           width: 120, strong: true, signColor: true },
  ];

  const rows: DrillRow[] = visibleYears.map((py) => {
    const additions = additionsTotal(py);
    const distributions = distributionsTotal(py);
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells: {
        additions,
        distributions,
        net: additions - distributions,
      },
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);

  // Chart values come straight from the rows already computed above, so the
  // account-ledger traversal in additionsTotal/distributionsTotal runs once.
  const chartSpec = buildDrillChartSpec({
    years: rows.map((r) => r.year),
    stacks: [
      { seriesId: "additions",     label: "Additions",     color: "#16a34a", values: rows.map((r) => r.cells.additions) },
      { seriesId: "distributions", label: "Distributions", color: "#ef4444", values: rows.map((r) => -r.cells.distributions) },
    ],
    lines: [{
      seriesId: "net", label: "Net", color: PRESENTATION_THEME.chartLine,
      values: rows.map((r) => r.cells.net),
    }],
    markers,
  });

  return {
    title: "Portfolio Activity",
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
