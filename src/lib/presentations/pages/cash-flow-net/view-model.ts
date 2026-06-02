// Net Cash Flow drill-down view-model. Mirrors the Level-1 "cashflow" drill
// in cashflow-report.tsx ≈ line 1788: supplemental withdrawals grouped by
// asset category, plus Total Withdrawals, Portfolio (BoY), and the
// Withdrawal % ratio. Chart matches WithdrawalsChart — stacked bars of
// withdrawals by category.

import type { ProjectionYear, ClientData } from "@/engine/types";
import { isFullyEntityOwned } from "@/engine/ownership";
import type {
  DrillColumn,
  DrillPageData,
  DrillPageOptions,
  DrillRow,
} from "../../shared/drill-types";
import { filterYearsToRange, type RangeOption } from "../../shared/year-filter";
import { buildMarkers } from "../../shared/markers";
import { buildDrillChartSpec } from "../../shared/build-chart-spec";

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// Order mirrors NET_CASH_FLOW_CATEGORIES in cashflow-report.tsx.
const CATEGORIES: Array<{
  key: string;        // account category value
  label: string;
  color: string;      // chart color (matches withdrawals-chart.tsx)
}> = [
  { key: "cash",           label: "Cash Assets",    color: "#9ca3af" },
  { key: "taxable",        label: "Taxable Assets", color: "#facc15" },
  { key: "retirement",     label: "Retirement",     color: "#f97316" },
  { key: "real_estate",    label: "Real Estate",    color: "#0891b2" },
  { key: "business",       label: "Business",       color: "#7c3aed" },
  { key: "life_insurance", label: "Life Insurance", color: "#16a34a" },
];

const HEADERS: Record<string, string> = {
  cash:           "Cash\nAssets",
  taxable:        "Taxable\nAssets",
  retirement:     "Retirement",
  real_estate:    "Real\nEstate",
  business:       "Business",
  life_insurance: "Life\nInsurance",
};

export interface BuildNetCashFlowDrillInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function buildNetCashFlowDrillData(input: BuildNetCashFlowDrillInput): DrillPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;
  const visibleYears = filterYearsToRange(years, clientData, options.range as RangeOption);

  // Recover the same accountId → category map cashflow-report.tsx builds. We
  // need it to roll up `withdrawals.byAccount` to category totals + to scope
  // the synthetic-account recovery the engine relies on.
  const accountCategoryById: Record<string, string> = {};
  for (const acc of clientData.accounts) {
    if (isFullyEntityOwned(acc)) continue;
    accountCategoryById[acc.id] = acc.category;
  }
  const PORTFOLIO_BUCKET_TO_CATEGORY: Record<string, string> = {
    taxable: "taxable",
    cash: "cash",
    retirement: "retirement",
    realEstate: "real_estate",
    business: "business",
    lifeInsurance: "life_insurance",
  };
  for (const y of years) {
    for (const [bucket, category] of Object.entries(PORTFOLIO_BUCKET_TO_CATEGORY)) {
      const map = (y.portfolioAssets as Record<string, unknown>)[bucket];
      if (!map || typeof map !== "object") continue;
      for (const id of Object.keys(map as Record<string, number>)) {
        if (!(id in accountCategoryById)) accountCategoryById[id] = category;
      }
    }
  }

  function withdrawalByCategory(r: ProjectionYear, category: string): number {
    let sum = 0;
    for (const [accId, amount] of Object.entries(r.withdrawals.byAccount)) {
      if (accountCategoryById[accId] === category) sum += amount;
    }
    return sum;
  }

  function portfolioBoy(r: ProjectionYear): number {
    const prev = years.find((y) => y.year === r.year - 1);
    // H1: roll the canonical liquid portfolio total forward so the withdrawal %
    // is taken against the same base the chart/cell show.
    if (prev) return prev.portfolioAssets.liquidTotal;
    // Year-1 fallback: only liquid-category ledgers (mirrors the liquidTotal
    // definition). Accessible-trust accounts won't carry a category in year 1,
    // so this is best-effort for the first year only; the `prev` path is exact
    // for every year thereafter.
    const LIQUID = new Set(["taxable", "cash", "retirement", "life_insurance"]);
    return Object.entries(r.accountLedgers).reduce(
      (s, [id, l]) => s + (LIQUID.has(accountCategoryById[id] ?? "") ? l.beginningValue : 0),
      0,
    );
  }

  // Supplemental withdrawals from accounts that never resolve to a category
  // (absent from clientData.accounts and every portfolio bucket). They still
  // count in withdrawals.total, so without an "Other" column the per-category
  // columns wouldn't sum to Total Withdrawals (H4).
  function uncategorizedWithdrawal(r: ProjectionYear): number {
    let sum = 0;
    for (const [accId, amount] of Object.entries(r.withdrawals.byAccount)) {
      if (!accountCategoryById[accId]) sum += amount;
    }
    return sum;
  }
  const hasUncategorized = years.some((y) => uncategorizedWithdrawal(y) > 0.5);

  // Only show categories that had any supplemental withdrawal across the full
  // projection — keeps the column set stable.
  const categoriesUsed = new Set<string>();
  for (const y of years) {
    for (const accId of Object.keys(y.withdrawals.byAccount)) {
      const cat = accountCategoryById[accId];
      if (cat) categoriesUsed.add(cat);
    }
  }
  const activeCats = CATEGORIES.filter((c) => categoriesUsed.has(c.key));

  // ── Columns ──────────────────────────────────────────────────────────────
  const dataColumns: DrillColumn[] = activeCats.map((c) => ({
    key: c.key,
    header: HEADERS[c.key] ?? c.label,
    width: 44,
  }));
  const columns: DrillColumn[] = [
    ...dataColumns,
    ...(hasUncategorized ? [{ key: "other", header: "Other", width: 44 } as DrillColumn] : []),
    { key: "total",   header: "Total\nWithdrawals", width: 56, strong: true },
    { key: "boy",     header: "Portfolio\n(BoY)",   width: 56 },
    { key: "wdPct",   header: "Withdrawal\n%",      width: 50, format: "percent" },
  ];

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rows: DrillRow[] = visibleYears.map((py) => {
    const cells: Record<string, number> = {};
    for (const c of activeCats) cells[c.key] = withdrawalByCategory(py, c.key);
    if (hasUncategorized) cells.other = uncategorizedWithdrawal(py);
    cells.total = py.withdrawals.total;
    const boy = portfolioBoy(py);
    cells.boy = boy;
    // F82: the engine sets `rmdAmount` on EVERY rmd-enabled ledger, but
    // entity-owned (non-IIP trust) accounts route their RMD to entity checking —
    // not a household supplemental withdrawal. Scope the numerator to accounts
    // that resolve to a household category (the same map the columns use), which
    // excludes fully-entity-owned accounts and the trustsAndBusinesses bucket.
    const rmdTotal = Object.entries(py.accountLedgers ?? {}).reduce(
      (sum, [id, led]) => sum + (accountCategoryById[id] ? led?.rmdAmount ?? 0 : 0),
      0,
    );
    cells.wdPct = boy > 0 ? (py.withdrawals.total + rmdTotal) / boy : 0;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells,
    };
  });

  // ── Chart ────────────────────────────────────────────────────────────────
  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const stacks = activeCats.map((c) => ({
    seriesId: `wd:${c.key}`,
    label: c.label,
    color: c.color,
    values: visibleYears.map((y) => withdrawalByCategory(y, c.key)),
  }));
  if (hasUncategorized) {
    stacks.push({
      seriesId: "wd:other",
      label: "Other",
      color: "#6b7280", // gray-500, distinct from Cash (#9ca3af)
      values: visibleYears.map((y) => uncategorizedWithdrawal(y)),
    });
  }
  const chartSpec = buildDrillChartSpec({
    years: visibleYears.map((y) => y.year),
    stacks,
    markers,
  });

  return {
    title: "Net Cash Flow",
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
  if (options.range === "retirement") return "Supplemental withdrawals begin at Retirement.";
  return undefined;
}
