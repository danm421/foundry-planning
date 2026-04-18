// src/components/balance-sheet-report/view-model.ts
import { filterAccounts, filterLiabilities, type OwnershipView } from "./ownership-filter";
import { yoyPct, sliceBarAnchors, type YoyResult } from "./yoy";
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
  /** Per-account EOY balance for every account (including out-of-estate
   * entity-owned accounts that are excluded from portfolioAssets). The balance
   * sheet sources row values from here so irrevocable trust accounts surface
   * in the consolidated and entities-only views. */
  accountLedgers: Record<string, { endingValue: number; beginningValue: number }>;
}

export interface EntityInfo {
  id: string;
  name: string;
  /** "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other" */
  entityType: string;
}

export type AsOfMode = "today" | "eoy";

export interface BuildViewModelInput {
  accounts: AccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  projectionYears: ProjectionYearLike[];
  selectedYear: number;
  view: OwnershipView;
  /** "today" = beginning-of-year balances for the first projection year
   * (the advisor-entered current balances). "eoy" = end-of-year balances
   * for the selected year. Default: "eoy". */
  asOfMode?: AsOfMode;
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

/** One group per entity, populated only in the "entities" view. Each entity
 * gets a card listing its assets and liabilities with per-entity subtotals. */
export interface EntityGroup {
  entityId: string;
  entityName: string;
  entityType: string;
  assetRows: AssetRow[];
  assetTotal: number;
  liabilityRows: LiabilityRow[];
  liabilityTotal: number;
  netWorth: number;
}

export interface BalanceSheetViewModel {
  selectedYear: number;
  assetCategories: AssetCategoryGroup[];
  /** Entity-owned assets displayed separately in consolidated view. Empty in
   * other views. Does NOT contribute to totalAssets / netWorth / donut /
   * realEstateEquity — out-of-estate is its own standalone section. */
  outOfEstateRows: AssetRow[];
  /** Entity-owned liabilities alongside out-of-estate assets. Same exclusion
   * semantics as outOfEstateRows. Empty outside consolidated view. */
  outOfEstateLiabilityRows: LiabilityRow[];
  /** Sum of outOfEstateRows − outOfEstateLiabilityRows. 0 when empty. */
  outOfEstateNetWorth: number;
  liabilityRows: LiabilityRow[];
  /** Present only when view === "entities". Flat `assetCategories` and
   * `liabilityRows` remain populated for fallback and for totals/charts. */
  entityGroups?: EntityGroup[];
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

function findPriorYear(
  projectionYears: ProjectionYearLike[],
  selectedYear: number,
): ProjectionYearLike | null {
  const idx = projectionYears.findIndex((y) => y.year === selectedYear);
  if (idx <= 0) return null;
  return projectionYears[idx - 1];
}

/** Pulls the per-account balance from accountLedgers: beginning-of-year in
 * "today" mode (matches the advisor-entered current balance) or end-of-year
 * in "eoy" mode (matches the projected balance at the end of the selected
 * year). Includes out-of-estate entity-owned accounts either way. */
function accountValueForYear(
  yearData: ProjectionYearLike,
  accountId: string,
  mode: AsOfMode,
): number {
  const ledger = yearData.accountLedgers[accountId];
  if (!ledger) return 0;
  return mode === "today" ? ledger.beginningValue : ledger.endingValue;
}

/** In consolidated view, entity-owned rows (ownerEntityId != null) are shown
 * separately and excluded from household totals. Other views already scope by
 * owner. */
function inEstateOnly<T extends { ownerEntityId?: string | null }>(
  rows: T[],
  view: OwnershipView,
): T[] {
  return view === "consolidated"
    ? rows.filter((r) => r.ownerEntityId == null)
    : rows;
}

function filteredAssetTotalForYear(
  yearData: ProjectionYearLike,
  accounts: AccountLike[],
  view: OwnershipView,
  mode: AsOfMode,
): number {
  const filtered = inEstateOnly(filterAccounts(accounts, view), view);
  return filtered.reduce(
    (sum, a) => sum + accountValueForYear(yearData, a.id, mode),
    0,
  );
}

function filteredLiabilityTotalForYear(
  yearData: ProjectionYearLike,
  liabilities: LiabilityLike[],
  view: OwnershipView,
): number {
  const filtered = inEstateOnly(filterLiabilities(liabilities, view), view);
  const filteredIds = new Set(filtered.map((l) => l.id));
  let total = 0;
  for (const [id, balance] of Object.entries(yearData.liabilityBalancesBoY)) {
    if (filteredIds.has(id)) total += balance;
  }
  return total;
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildViewModel(input: BuildViewModelInput): BalanceSheetViewModel {
  const { accounts, liabilities, entities, projectionYears, selectedYear, view } = input;
  const asOfMode: AsOfMode = input.asOfMode ?? "eoy";

  // "Today" mode snapshots the first projection year's beginning-of-year
  // balances — i.e., the balances the advisor entered. No prior year to
  // compute YoY against in that mode.
  const yearData =
    asOfMode === "today"
      ? projectionYears[0]
      : projectionYears.find((y) => y.year === selectedYear);
  if (!yearData) throw new Error(`Projection year ${selectedYear} not found`);

  const priorYear =
    asOfMode === "today" ? null : findPriorYear(projectionYears, selectedYear);

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

  // Pre-group accounts by category key so each category loop iteration only
  // scans its own accounts.
  const accountsByCategory = new Map<AssetCategoryKey, AccountLike[]>();
  for (const acct of accounts) {
    const catKey = DB_TO_KEY[acct.category];
    if (!catKey) continue;
    const list = accountsByCategory.get(catKey) ?? [];
    list.push(acct);
    accountsByCategory.set(catKey, list);
  }

  for (const categoryKey of CATEGORY_ORDER) {
    const categoryAccounts = accountsByCategory.get(categoryKey) ?? [];
    const rows: AssetRow[] = [];
    const outRows: AssetRow[] = [];

    for (const acct of categoryAccounts) {
      if (!filteredAccountIds.has(acct.id)) continue;
      const value = accountValueForYear(yearData, acct.id, asOfMode);
      if (value <= 0) continue;

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
      ? categoryAccounts
          .filter(
            (a) =>
              filteredAccountIds.has(a.id) &&
              (view !== "consolidated" || a.ownerEntityId == null),
          )
          .reduce((sum, a) => sum + accountValueForYear(priorYear, a.id, "eoy"), 0)
      : null;

    // Include the category if it has in-estate rows. Out-of-estate is a
    // separate section (centerColumn) and does not influence category cards.
    if (total > 0 || rows.length > 0) {
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

  // ── Liabilities: flat list, filtered; entity-owned split off in consolidated ──

  const filteredLiabIds = new Set(filterLiabilities(liabilities, view).map((l) => l.id));
  const allLiabRows: LiabilityRow[] = liabilities
    .filter((l) => filteredLiabIds.has(l.id))
    .map((l) => ({
      liabilityId: l.id,
      liabilityName: l.name,
      owner: l.owner ?? null,
      ownerEntityId: l.ownerEntityId ?? null,
      balance: yearData.liabilityBalancesBoY[l.id] ?? 0,
    }))
    .filter((r) => r.balance > 0);

  const liabilityRows: LiabilityRow[] =
    view === "consolidated"
      ? allLiabRows.filter((r) => r.ownerEntityId == null)
      : allLiabRows;
  const outOfEstateLiabilityRows: LiabilityRow[] =
    view === "consolidated"
      ? allLiabRows.filter((r) => r.ownerEntityId != null)
      : [];

  // ── Entity groups: populated only in the "entities" view ──
  //
  // Each entity gets a card listing its owned assets (across all categories)
  // and liabilities, with per-entity subtotals. Entities with no rows are
  // omitted so the panel doesn't render empty cards.

  let entityGroups: EntityGroup[] | undefined;
  if (view === "entities") {
    // Gather all entity-owned asset rows across categories (in "entities"
    // view these all land in `rows`, not `outRows`).
    const allAssetRows = assetCategories.flatMap((c) => c.rows);
    const assetsByEntity = new Map<string, AssetRow[]>();
    for (const row of allAssetRows) {
      if (!row.ownerEntityId) continue;
      const list = assetsByEntity.get(row.ownerEntityId) ?? [];
      list.push(row);
      assetsByEntity.set(row.ownerEntityId, list);
    }
    const liabsByEntity = new Map<string, LiabilityRow[]>();
    for (const row of allLiabRows) {
      if (!row.ownerEntityId) continue;
      const list = liabsByEntity.get(row.ownerEntityId) ?? [];
      list.push(row);
      liabsByEntity.set(row.ownerEntityId, list);
    }

    entityGroups = entities
      .map((e) => {
        const assetRows = assetsByEntity.get(e.id) ?? [];
        const liabRows = liabsByEntity.get(e.id) ?? [];
        const assetTotal = assetRows.reduce((s, r) => s + r.value, 0);
        const liabilityTotal = liabRows.reduce((s, r) => s + r.balance, 0);
        return {
          entityId: e.id,
          entityName: e.name,
          entityType: e.entityType,
          assetRows,
          assetTotal,
          liabilityRows: liabRows,
          liabilityTotal,
          netWorth: assetTotal - liabilityTotal,
        };
      })
      .filter((g) => g.assetRows.length > 0 || g.liabilityRows.length > 0);
  }

  // ── Totals (in-estate only; out-of-estate stands apart) ──

  const totalAssets = assetCategories.reduce((sum, c) => sum + c.total, 0);
  const totalLiabilities = liabilityRows.reduce((sum, r) => sum + r.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  const outOfEstateAssetTotal = outOfEstateRows.reduce((sum, r) => sum + r.value, 0);
  const outOfEstateLiabilityTotal = outOfEstateLiabilityRows.reduce(
    (sum, r) => sum + r.balance,
    0,
  );
  const outOfEstateNetWorth = outOfEstateAssetTotal - outOfEstateLiabilityTotal;

  // ── Real estate equity = in-estate real-estate market value − linked mortgages ──
  // Out-of-estate real estate is reflected in the Out of Estate section, not here.

  const realEstateCategory = assetCategories.find((c) => c.key === "realEstate");
  const realEstateMarketValue =
    realEstateCategory?.rows.reduce((sum, r) => sum + r.value, 0) ?? 0;

  const linkedMortgageBalance = (realEstateCategory?.rows ?? [])
    .flatMap((row) => mortgagesByPropertyId.get(row.accountId) ?? [])
    .filter((liab) => liab.ownerEntityId == null)
    .reduce((sum, liab) => sum + (yearData.liabilityBalancesBoY[liab.id] ?? 0), 0);

  const realEstateEquity = realEstateMarketValue - linkedMortgageBalance;

  // ── Donut: one slice per non-zero in-estate asset category ──

  const donut: DonutSlice[] = [];
  for (const cat of assetCategories) {
    if (cat.total <= 0) continue;
    donut.push({
      key: cat.key,
      label: cat.label,
      value: cat.total,
      hex: CATEGORY_HEX[cat.key],
    });
  }

  // ── Bar chart: current / +10yr / +20yr / last-if-past-+20 ──
  // Anchor is the current year (first projection year in Today mode, else selectedYear).

  const allYears = projectionYears.map((y) => y.year);
  const windowAnchor = asOfMode === "today" ? projectionYears[0].year : selectedYear;
  const windowYears = sliceBarAnchors(allYears, windowAnchor);
  const barChartSeries: BarChartPoint[] = windowYears.map((yr) => {
    const yData = projectionYears.find((y) => y.year === yr)!;
    return {
      year: yr,
      assets: filteredAssetTotalForYear(yData, accounts, view, "eoy"),
      liabilities: filteredLiabilityTotalForYear(yData, liabilities, view),
    };
  });

  // ── YoY ──

  const priorTotalAssets = priorYear
    ? filteredAssetTotalForYear(priorYear, accounts, view, "eoy")
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
    outOfEstateLiabilityRows,
    outOfEstateNetWorth,
    liabilityRows,
    entityGroups,
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
