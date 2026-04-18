// src/components/balance-sheet-report/view-model.ts
import { filterAccounts, filterLiabilities, type OwnershipView } from "./ownership-filter";
import { yoyPct, sliceBarWindow, type YoyResult } from "./yoy";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_HEX, type AssetCategoryKey } from "./tokens";

// ── Input shapes (loose — accept what /api/projection-data returns) ──────────

export interface AccountLike {
  id: string;
  name: string;
  category: string; // "cash" | "taxable" | "retirement" | "real_estate" | "business" | "life_insurance"
  owner: "client" | "spouse" | "joint";
  ownerEntityId?: string | null;
}

export interface LiabilityLike {
  id: string;
  name: string;
  owner?: "client" | "spouse" | "joint" | null;
  ownerEntityId?: string | null;
  linkedPropertyId?: string | null;
}

export interface ProjectionYearLike {
  year: number;
  portfolioAssets: {
    cash: Record<string, number>;
    taxable: Record<string, number>;
    retirement: Record<string, number>;
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    total: number;
  };
  liabilityBalancesBoY: Record<string, number>;
}

export interface BuildViewModelInput {
  accounts: AccountLike[];
  liabilities: LiabilityLike[];
  projectionYears: ProjectionYearLike[];
  selectedYear: number;
  view: OwnershipView;
}

// ── Output shape ─────────────────────────────────────────────────────────────

export interface AssetRow {
  accountId: string;
  accountName: string;
  owner: "client" | "spouse" | "joint";
  ownerEntityId: string | null;
  value: number;
  /** True when this is a real-estate row with a linked mortgage. */
  hasLinkedMortgage: boolean;
}

export interface AssetCategoryGroup {
  key: AssetCategoryKey;
  label: string;
  total: number;
  rows: AssetRow[];
  yoy: YoyResult | null;
}

export interface LiabilityRow {
  liabilityId: string;
  liabilityName: string;
  owner: "client" | "spouse" | "joint" | null;
  ownerEntityId: string | null;
  balance: number;
}

export interface DonutSlice {
  key: AssetCategoryKey;
  label: string;
  value: number;
  hex: string;
}

export interface BarChartPoint {
  year: number;
  assets: number;
  liabilities: number;
}

export interface BalanceSheetViewModel {
  selectedYear: number;
  assetCategories: AssetCategoryGroup[];
  outOfEstateRows: AssetRow[];
  liabilityRows: LiabilityRow[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  realEstateEquity: number;
  donut: DonutSlice[];
  barChartSeries: BarChartPoint[];
  yoy: {
    totalAssets: YoyResult | null;
    totalLiabilities: YoyResult | null;
    netWorth: YoyResult | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DB_TO_KEY: Record<string, AssetCategoryKey> = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  real_estate: "realEstate",
  business: "business",
  life_insurance: "lifeInsurance",
};

function categoryMap(
  yearData: ProjectionYearLike,
  key: AssetCategoryKey,
): Record<string, number> {
  return yearData.portfolioAssets[key];
}

function findPriorYear(
  projectionYears: ProjectionYearLike[],
  selectedYear: number,
): ProjectionYearLike | null {
  const idx = projectionYears.findIndex((y) => y.year === selectedYear);
  if (idx <= 0) return null;
  return projectionYears[idx - 1];
}

/**
 * Compute the filtered total for a single year by joining the projection's
 * per-account-id map against the account list filtered by view.
 * For the consolidated view, use portfolioAssets.total directly since it
 * represents the full unfiltered total that the engine computed.
 */
function filteredAssetTotalForYear(
  yearData: ProjectionYearLike,
  accounts: AccountLike[],
  view: OwnershipView,
): number {
  if (view === "consolidated") return yearData.portfolioAssets.total;
  const filtered = filterAccounts(accounts, view);
  const filteredIds = new Set(filtered.map((a) => a.id));
  let total = 0;
  for (const categoryKey of CATEGORY_ORDER) {
    const values = categoryMap(yearData, categoryKey);
    for (const [accountId, value] of Object.entries(values)) {
      if (filteredIds.has(accountId)) total += value;
    }
  }
  return total;
}

function filteredLiabilityTotalForYear(
  yearData: ProjectionYearLike,
  liabilities: LiabilityLike[],
  view: OwnershipView,
): number {
  const filtered = filterLiabilities(liabilities, view);
  const filteredIds = new Set(filtered.map((l) => l.id));
  let total = 0;
  for (const [id, balance] of Object.entries(yearData.liabilityBalancesBoY)) {
    if (filteredIds.has(id)) total += balance;
  }
  return total;
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildViewModel(input: BuildViewModelInput): BalanceSheetViewModel {
  const { accounts, liabilities, projectionYears, selectedYear, view } = input;

  const yearData = projectionYears.find((y) => y.year === selectedYear);
  if (!yearData) throw new Error(`Projection year ${selectedYear} not found`);

  const priorYear = findPriorYear(projectionYears, selectedYear);

  // Account lookup by id (projection engine keys portfolioAssets by acct.id).
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Liabilities linked to real-estate accounts → used for mortgage indicators
  // and real-estate equity.
  const mortgagesByPropertyId = new Map<string, LiabilityLike[]>();
  for (const liab of liabilities) {
    if (!liab.linkedPropertyId) continue;
    const list = mortgagesByPropertyId.get(liab.linkedPropertyId) ?? [];
    list.push(liab);
    mortgagesByPropertyId.set(liab.linkedPropertyId, list);
  }

  // ── Assets: grouped by category, filtered, with entity-owned split for consolidated view ──

  const filteredAccountIds = new Set(
    filterAccounts(accounts, view).map((a) => a.id),
  );

  const assetCategories: AssetCategoryGroup[] = [];
  const outOfEstateRows: AssetRow[] = [];

  for (const categoryKey of CATEGORY_ORDER) {
    const perAccountValues = categoryMap(yearData, categoryKey);
    const rows: AssetRow[] = [];
    const outRows: AssetRow[] = [];

    for (const [accountId, value] of Object.entries(perAccountValues)) {
      const acct = accountById.get(accountId);
      if (!acct) continue; // projection output for an account not in our list (shouldn't happen)
      if (!filteredAccountIds.has(acct.id)) continue;

      const row: AssetRow = {
        accountId: acct.id,
        accountName: acct.name,
        owner: acct.owner,
        ownerEntityId: acct.ownerEntityId ?? null,
        value,
        hasLinkedMortgage:
          categoryKey === "realEstate" &&
          (mortgagesByPropertyId.get(acct.id)?.length ?? 0) > 0,
      };

      if (view === "consolidated" && row.ownerEntityId != null) {
        outRows.push(row);
      } else {
        rows.push(row);
      }
    }

    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const priorTotal = priorYear
      ? Object.entries(categoryMap(priorYear, categoryKey))
          .filter(([id]) => {
            const acct = accountById.get(id);
            return acct && filteredAccountIds.has(acct.id) && (view !== "consolidated" || acct.ownerEntityId == null);
          })
          .reduce((sum, [, v]) => sum + v, 0)
      : null;

    // Include the category if it has in-estate rows OR (consolidated) out-of-estate rows.
    if (total > 0 || rows.length > 0 || outRows.length > 0) {
      assetCategories.push({
        key: categoryKey,
        label: CATEGORY_LABELS[categoryKey],
        total,
        rows,
        yoy: yoyPct(total, priorTotal),
      });
    }

    outOfEstateRows.push(...outRows);
  }

  // ── Liabilities: flat list, filtered ──

  const filteredLiabIds = new Set(filterLiabilities(liabilities, view).map((l) => l.id));
  const liabilityRows: LiabilityRow[] = liabilities
    .filter((l) => filteredLiabIds.has(l.id))
    .map((l) => ({
      liabilityId: l.id,
      liabilityName: l.name,
      owner: l.owner ?? null,
      ownerEntityId: l.ownerEntityId ?? null,
      balance: yearData.liabilityBalancesBoY[l.id] ?? 0,
    }))
    .filter((r) => r.balance > 0);

  // ── Totals ──

  const totalAssets =
    assetCategories.reduce((sum, c) => sum + c.total, 0) +
    outOfEstateRows.reduce((sum, r) => sum + r.value, 0);
  const totalLiabilities = liabilityRows.reduce((sum, r) => sum + r.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  // ── Real estate equity = all filtered real-estate market value − linked mortgage balances ──

  const realEstateCategory = assetCategories.find((c) => c.key === "realEstate");
  const realEstateMarketValue =
    (realEstateCategory?.rows.reduce((sum, r) => sum + r.value, 0) ?? 0) +
    (view === "consolidated"
      ? outOfEstateRows
          .filter((r) => {
            const acct = accountById.get(r.accountId);
            return acct && DB_TO_KEY[acct.category] === "realEstate";
          })
          .reduce((sum, r) => sum + r.value, 0)
      : 0);

  const linkedMortgageBalance = (realEstateCategory?.rows ?? [])
    .concat(view === "consolidated" ? outOfEstateRows : [])
    .flatMap((row) => mortgagesByPropertyId.get(row.accountId) ?? [])
    .reduce((sum, liab) => sum + (yearData.liabilityBalancesBoY[liab.id] ?? 0), 0);

  const realEstateEquity = realEstateMarketValue - linkedMortgageBalance;

  // ── Donut: one slice per non-zero asset category, including out-of-estate if consolidated ──

  const donut: DonutSlice[] = [];
  for (const cat of assetCategories) {
    let value = cat.total;
    if (view === "consolidated") {
      value += outOfEstateRows
        .filter((r) => {
          const acct = accountById.get(r.accountId);
          return acct && DB_TO_KEY[acct.category] === cat.key;
        })
        .reduce((sum, r) => sum + r.value, 0);
    }
    if (value <= 0) continue;
    donut.push({
      key: cat.key,
      label: cat.label,
      value,
      hex: CATEGORY_HEX[cat.key],
    });
  }

  // ── Bar chart: 2 back / selected / 2 forward, values respecting the filter ──

  const allYears = projectionYears.map((y) => y.year);
  const windowYears = sliceBarWindow(allYears, selectedYear);
  const barChartSeries: BarChartPoint[] = windowYears.map((yr) => {
    const yData = projectionYears.find((y) => y.year === yr)!;
    return {
      year: yr,
      assets: filteredAssetTotalForYear(yData, accounts, view),
      liabilities: filteredLiabilityTotalForYear(yData, liabilities, view),
    };
  });

  // ── YoY ──

  const priorTotalAssets = priorYear
    ? filteredAssetTotalForYear(priorYear, accounts, view)
    : null;
  const priorTotalLiabilities = priorYear
    ? filteredLiabilityTotalForYear(priorYear, liabilities, view)
    : null;
  const priorNetWorth =
    priorTotalAssets != null && priorTotalLiabilities != null
      ? priorTotalAssets - priorTotalLiabilities
      : null;

  return {
    selectedYear,
    assetCategories,
    outOfEstateRows,
    liabilityRows,
    totalAssets,
    totalLiabilities,
    netWorth,
    realEstateEquity,
    donut,
    barChartSeries,
    yoy: {
      totalAssets: yoyPct(totalAssets, priorTotalAssets),
      totalLiabilities: yoyPct(totalLiabilities, priorTotalLiabilities),
      netWorth: yoyPct(netWorth, priorNetWorth),
    },
  };
}
