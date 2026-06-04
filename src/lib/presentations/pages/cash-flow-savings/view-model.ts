// Savings drill-down view-model. Mirrors the Level-1 Savings drill in
// cashflow-report.tsx ≈ line 1746: per-account columns + bold "Total" +
// "Employer Total". Chart stacks by account sub-type using the same color
// map as components/cashflow/charts/savings-chart.tsx.

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

// Sub-type → display label (matches savings-chart.tsx).
const SUB_TYPE_LABELS: Record<string, string> = {
  "401k":     "401k",
  "403b":     "403b",
  ira:        "IRA",
  roth_ira:   "Roth IRA",
  roth_401k:  "Roth 401k",
  brokerage:  "Brokerage",
  hsa:        "HSA",
  "529":      "529",
  checking:   "Cash",
  savings:    "Cash",
};

const SUB_TYPE_COLORS: Record<string, string> = {
  "401k":     dataLight.green,
  "403b":     dataLight.green,
  ira:        dataLight.blue,
  roth_ira:   dataLight.purple,
  roth_401k:  dataLight.purple,
  brokerage:  dataLight.yellow,
  hsa:        dataLight.teal,
  "529":      dataLight.orange,
  checking:   dataLight.grey,
  savings:    dataLight.grey,
};

const FALLBACK_COLOR = dataLight.pink;

export interface BuildSavingsDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildSavingsDrillData(input: BuildSavingsDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, options.range as RangeOption);

  // Per-account columns: every account that received savings in any year,
  // sorted by display order in clientData.accounts so the column order is
  // stable.
  const accountNames: Record<string, string> = {};
  const accountSubTypes: Record<string, string> = {};
  for (const acc of clientData.accounts) {
    accountNames[acc.id] = acc.name;
    accountSubTypes[acc.id] = acc.subType;
  }
  const savingsAccountIds = Array.from(
    new Set(years.flatMap((y) => Object.keys(y.savings.byAccount))),
  ).filter((id) =>
    years.some((y) => Math.abs(y.savings.byAccount[id] ?? 0) >= 0.5),
  );

  // ── Columns ──────────────────────────────────────────────────────────────
  // Width budget: ~460pt across (per-account + Total + Employer). If we have
  // a lot of accounts, columns shrink to keep us inside the page.
  const numCols = savingsAccountIds.length + 2; // + Total + Employer
  const dataWidth = Math.max(34, Math.floor(420 / Math.max(1, savingsAccountIds.length)));

  const dataColumns: DrillColumn[] = savingsAccountIds.map((id) => ({
    key: `acct_${id}`,
    header: accountNames[id] ?? id,
    width: dataWidth,
  }));
  const columns: DrillColumn[] = [
    ...dataColumns,
    { key: "total",    header: "Total",          width: 56, strong: true },
    { key: "employer", header: "Employer\nTotal", width: 56 },
  ];
  void numCols; // intentionally unused beyond width math

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const id of savingsAccountIds) {
      cells[`acct_${id}`] = py.savings.byAccount[id] ?? 0;
    }
    cells.total = py.savings.total;
    cells.employer = py.savings.employerTotal;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  // ── Chart ────────────────────────────────────────────────────────────────
  // Sum savings into sub-type buckets so the chart matches savings-chart.tsx.
  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const bucketTotals = new Map<string, { color: string; values: number[] }>();
  for (let yi = 0; yi < visibleYears.length; yi++) {
    const y = visibleYears[yi];
    for (const [accId, amt] of Object.entries(y.savings.byAccount)) {
      const sub = accountSubTypes[accId];
      const label = sub ? (SUB_TYPE_LABELS[sub] ?? "Other") : "Other";
      const color = (sub && SUB_TYPE_COLORS[sub]) ?? FALLBACK_COLOR;
      if (!bucketTotals.has(label)) {
        bucketTotals.set(label, { color, values: new Array(visibleYears.length).fill(0) });
      }
      bucketTotals.get(label)!.values[yi] += amt;
    }
  }
  const stacks = Array.from(bucketTotals.entries())
    .filter(([, b]) => b.values.some((v) => Math.abs(v) >= 0.5))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, b]) => ({
      seriesId: `savings:${label}`,
      label,
      color: b.color,
      values: b.values,
    }));

  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks,
    markers,
  });

  return {
    title: "Savings",
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
