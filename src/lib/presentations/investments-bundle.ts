import {
  resolveAccountAllocation,
  type AccountLite,
  type AccountAllocationResult,
  type PlanSettingsLite,
  type AssetClassLite,
  type GrowthSource,
  toGrowthSource,
} from "@/lib/investments/allocation";
import type { AssetClassWeight, ModelPortfolioLite } from "@/lib/investments/benchmarks";
import type { ResolverDeps, ResolvedGroup } from "@/lib/account-groups/resolver";
import type { AccountHoldingsGroup } from "@/lib/investments/holdings-inventory";

/** One investable account, carrying everything both view-models need. */
export interface BundleAccount {
  id: string;
  name: string;
  category: AccountLite["category"];
  growthSource: GrowthSource;
  modelPortfolioId: string | null;
  tickerPortfolioId: string | null;
  value: number;
  ownerEntityId: string | null;
  /** entity.includeInPortfolio for the owning entity (false for household-owned). */
  entityInPortfolio: boolean;
}

export interface BundleAssetClassData {
  id: string;
  arithmeticMean: number;
  geometricReturn: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

/** One plan-level category growth default, mirroring the Growth & Inflation tab.
 *  `source` selects how the category grows; `modelPortfolioId` is set only for
 *  the three investable categories when `source === "model_portfolio"`;
 *  `customRate` is the flat `default_growth_*` rate (used when `source === "custom"`). */
export interface CategoryGrowthDefault {
  source: GrowthSource;
  modelPortfolioId: string | null;
  customRate: number;
}

export interface PlanGrowthDefaults {
  taxable: CategoryGrowthDefault;
  cash: CategoryGrowthDefault;
  retirement: CategoryGrowthDefault;
  realEstate: CategoryGrowthDefault;
  business: CategoryGrowthDefault;
  lifeInsurance: CategoryGrowthDefault;
}

/** Structural subset of the `planSettings` DB row that `buildPlanGrowthDefaults`
 *  reads. Decimal columns arrive as strings from Drizzle. */
interface PlanGrowthRow {
  growthSourceTaxable?: string | null;
  growthSourceCash?: string | null;
  growthSourceRetirement?: string | null;
  growthSourceRealEstate?: string | null;
  growthSourceBusiness?: string | null;
  growthSourceLifeInsurance?: string | null;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  defaultGrowthTaxable?: string | number | null;
  defaultGrowthCash?: string | number | null;
  defaultGrowthRetirement?: string | number | null;
  defaultGrowthRealEstate?: string | number | null;
  defaultGrowthBusiness?: string | number | null;
  defaultGrowthLifeInsurance?: string | number | null;
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
}

export function buildPlanGrowthDefaults(row: PlanGrowthRow): PlanGrowthDefaults {
  return {
    taxable: { source: toGrowthSource(row.growthSourceTaxable), modelPortfolioId: row.modelPortfolioIdTaxable ?? null, customRate: num(row.defaultGrowthTaxable) },
    cash: { source: toGrowthSource(row.growthSourceCash), modelPortfolioId: row.modelPortfolioIdCash ?? null, customRate: num(row.defaultGrowthCash) },
    retirement: { source: toGrowthSource(row.growthSourceRetirement), modelPortfolioId: row.modelPortfolioIdRetirement ?? null, customRate: num(row.defaultGrowthRetirement) },
    realEstate: { source: toGrowthSource(row.growthSourceRealEstate), modelPortfolioId: null, customRate: num(row.defaultGrowthRealEstate) },
    business: { source: toGrowthSource(row.growthSourceBusiness), modelPortfolioId: null, customRate: num(row.defaultGrowthBusiness) },
    lifeInsurance: { source: toGrowthSource(row.growthSourceLifeInsurance), modelPortfolioId: null, customRate: num(row.defaultGrowthLifeInsurance) },
  };
}

export interface InvestmentsBundle {
  clientId: string;
  firmId: string;
  accounts: BundleAccount[];
  assetClassLites: AssetClassLite[];
  assetClassData: BundleAssetClassData[];
  cashAssetClassId: string | null;
  riskFreeRate: number;
  correlationRows: { assetClassIdA: string; assetClassIdB: string; correlation: number }[];
  accountMixByAccountId: Record<string, AssetClassWeight[]>;
  modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>;
  tickerPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>;
  planLite: PlanSettingsLite;
  /** Six plan-level category growth defaults (Growth & Inflation tab). Populated
   *  by the loader; consumed by the Assumptions page. Optional so existing
   *  bundle-shaped test fixtures keep compiling. */
  planGrowthDefaults?: PlanGrowthDefaults;
  portfolioLites: ModelPortfolioLite[];
  selectedBenchmarkPortfolioId: string | null;
  customGroups: { id: string; name: string; color: string | null; accountIds: string[] }[];
  /** Pre-resolved at load time (keeps buildData synchronous). Keyed by group key. */
  resolvedGroups: Record<string, ResolvedGroup>;
  /** Selectable groups for the builder UI dropdown, in display order. */
  groupOptions: { key: string; name: string }[];
  /** Per-account holdings inventory (Assets → Investments → Holdings parity).
   *  Loaded only when the deck includes the Holdings page — see the
   *  `includeHoldings` loader flag. Optional so bundle-shaped test fixtures
   *  keep compiling. */
  holdings?: AccountHoldingsGroup[];
}

/** Re-create the allocation resolver closure over the bundle's indexes. */
export function buildInvestmentsResolver(
  bundle: InvestmentsBundle,
): (acct: AccountLite) => AccountAllocationResult {
  return (acct) =>
    resolveAccountAllocation(
      acct,
      bundle.accountMixByAccountId,
      bundle.modelPortfolioAllocationsByPortfolioId,
      bundle.planLite,
      bundle.cashAssetClassId,
      bundle.tickerPortfolioAllocationsByPortfolioId,
    );
}

/** Synchronous-data ResolverDeps backed entirely by the in-memory bundle. */
export function bundleGroupDeps(bundle: InvestmentsBundle): ResolverDeps {
  return {
    fetchAccounts: async () =>
      bundle.accounts.map((a) => ({ id: a.id, category: a.category })),
    fetchCustomGroup: async (_clientId, groupId) => {
      const g = bundle.customGroups.find((x) => x.id === groupId);
      return g ? { name: g.name, color: g.color, memberAccountIds: g.accountIds } : null;
    },
  };
}

// ─── DB loader ──────────────────────────────────────────────────────────────

import { db } from "@/db";
import {
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountOwners,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  assetClassCorrelations,
  modelPortfolios,
  modelPortfolioAllocations,
  entities as entitiesTable,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveGroup, DEFAULT_GROUP_KEYS, type GroupKey } from "@/lib/account-groups/resolver";
import { listAccountGroups } from "@/lib/account-groups/queries";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import { loadEnrichedHoldings } from "@/lib/investments/load-enriched-holdings";
import { buildHoldingsInventory } from "@/lib/investments/holdings-inventory";

/**
 * Load the full investments bundle for a client (base-case scenario). Pre-resolves
 * every selectable group so view-models stay synchronous. Mirrors the load logic
 * in investments-content.tsx. Returns null when the client has no base-case scenario/settings.
 */
export async function loadInvestmentsBundle(
  clientId: string,
  firmId: string,
  opts?: { includeHoldings?: boolean },
): Promise<InvestmentsBundle | null> {
  const [scenario] = await db.select().from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return null;

  const [settings] = await db.select().from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id)));
  if (!settings) return null;

  const [acctRows, classRows, portfolioRows, entityRows, correlationRows] =
    await Promise.all([
      db.select().from(accountsTable).where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id))),
      db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select({ id: entitiesTable.id, includeInPortfolio: entitiesTable.includeInPortfolio })
        .from(entitiesTable).where(eq(entitiesTable.clientId, clientId)),
      db.select({
        assetClassIdA: assetClassCorrelations.assetClassIdA,
        assetClassIdB: assetClassCorrelations.assetClassIdB,
        // decimal columns return string from Drizzle — coerce at the boundary
        correlation: assetClassCorrelations.correlation,
      }).from(assetClassCorrelations).then((rows) =>
        rows.map((r) => ({ ...r, correlation: Number(r.correlation) })),
      ),
    ]);

  // F79: the allocation tables carry no clientId/firmId, so they were
  // full-table-scanned and filtered in JS — loading every tenant's rows on
  // each export. Scope them at the DB level by the account/portfolio ids we
  // just loaded (both are already client/firm-scoped). Mirrors the deterministic
  // loader in load-client-data.ts.
  const accountIdList = acctRows.map((a) => a.id);
  const portfolioIdList = portfolioRows.map((p) => p.id);

  // Holdings only need acctRows — start the query now so it overlaps the
  // allocation/owner/group loads below instead of serializing after them.
  const enrichedHoldingsPromise = opts?.includeHoldings
    ? loadEnrichedHoldings(accountIdList)
    : null;
  // If a later query throws before we await, don't let this become an
  // unhandled rejection. Awaiting the original promise below still throws.
  enrichedHoldingsPromise?.catch(() => {});
  const [mixRows, portfolioAllocRows] = await Promise.all([
    accountIdList.length > 0
      ? db.select().from(accountAssetAllocations)
          .where(inArray(accountAssetAllocations.accountId, accountIdList))
      : Promise.resolve([]),
    portfolioIdList.length > 0
      ? db.select().from(modelPortfolioAllocations)
          .where(inArray(modelPortfolioAllocations.modelPortfolioId, portfolioIdList))
      : Promise.resolve([]),
  ]);

  const entityIncludeInPortfolio = new Map<string, boolean>();
  for (const e of entityRows) entityIncludeInPortfolio.set(e.id, e.includeInPortfolio);

  const accountEntityOwner = new Map<string, string>();
  if (acctRows.length > 0) {
    const ownerRows = await db
      .select({ accountId: accountOwners.accountId, entityId: accountOwners.entityId })
      .from(accountOwners)
      .where(inArray(accountOwners.accountId, acctRows.map((a) => a.id)));
    for (const row of ownerRows) if (row.entityId != null) accountEntityOwner.set(row.accountId, row.entityId);
  }

  const accountIds = new Set(acctRows.map((a) => a.id));
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({ assetClassId: row.assetClassId, weight: Number(row.weight) });
  }

  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const row of portfolioAllocRows) {
    (modelPortfolioAllocationsByPortfolioId[row.modelPortfolioId] ??= []).push({
      assetClassId: row.assetClassId, weight: Number(row.weight),
    });
  }

  // Fold this firm's fund (ticker) portfolios into asset-class weight rows keyed
  // by portfolio id, so ticker_portfolio accounts classify in the bundle resolver.
  const slugToAssetClassId = new Map<string, string>();
  for (const ac of classRows) if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);
  const tickerAllocRows = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);
  const tickerPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const r of tickerAllocRows)
    (tickerPortfolioAllocationsByPortfolioId[r.tickerPortfolioId] ??= []).push({
      assetClassId: r.assetClassId, weight: parseFloat(r.weight),
    });

  const customGroupRows = await listAccountGroups(clientId);

  const accounts: BundleAccount[] = acctRows.map((a) => {
    const entityId = accountEntityOwner.get(a.id) ?? null;
    return {
      id: a.id, name: a.name, category: a.category, growthSource: toGrowthSource(a.growthSource),
      modelPortfolioId: a.modelPortfolioId ?? null, tickerPortfolioId: a.tickerPortfolioId ?? null,
      value: Number(a.value),
      ownerEntityId: entityId,
      entityInPortfolio: entityId !== null && (entityIncludeInPortfolio.get(entityId) ?? false),
    };
  });

  const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
    id: c.id, name: c.name, sortOrder: c.sortOrder, assetType: c.assetType as AssetTypeId,
  }));
  const assetClassData: BundleAssetClassData[] = classRows.map((c) => ({
    id: c.id, arithmeticMean: Number(c.arithmeticMean), geometricReturn: Number(c.geometricReturn),
    volatility: Number(c.volatility), pctOrdinaryIncome: Number(c.pctOrdinaryIncome),
    pctLtCapitalGains: Number(c.pctLtCapitalGains), pctQualifiedDividends: Number(c.pctQualifiedDividends),
    pctTaxExempt: Number(c.pctTaxExempt),
  }));
  const cashClass = classRows.find((c) => c.slug === "cash") ?? null;
  const cashAssetClassId = cashClass?.id ?? null;
  const riskFreeRate = Number(cashClass?.arithmeticMean ?? 0);

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: toGrowthSource(settings.growthSourceTaxable),
    growthSourceCash: toGrowthSource(settings.growthSourceCash),
    growthSourceRetirement: toGrowthSource(settings.growthSourceRetirement),
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };

  const customGroups = customGroupRows.map((g) => ({
    id: g.id, name: g.name, color: g.color, accountIds: g.memberAccountIds,
  }));

  const bundle: InvestmentsBundle = {
    clientId, firmId, accounts, assetClassLites, assetClassData, cashAssetClassId, riskFreeRate,
    correlationRows,
    accountMixByAccountId, modelPortfolioAllocationsByPortfolioId,
    tickerPortfolioAllocationsByPortfolioId, planLite,
    planGrowthDefaults: buildPlanGrowthDefaults(settings),
    portfolioLites: portfolioRows.map((p) => ({ id: p.id, name: p.name })),
    selectedBenchmarkPortfolioId: settings.selectedBenchmarkPortfolioId ?? null,
    customGroups,
    resolvedGroups: {},
    groupOptions: [],
  };

  // Pre-resolve every selectable group (default keys + custom groups) in parallel,
  // preserving deterministic order: default keys first, then custom groups in order.
  const deps = bundleGroupDeps(bundle);
  const keys: GroupKey[] = [...DEFAULT_GROUP_KEYS, ...customGroups.map((g) => g.id)];
  const resolvedList = await Promise.all(
    keys.map((key) => resolveGroup(clientId, key, deps).catch(() => null)),
  );
  keys.forEach((key, i) => {
    const resolved = resolvedList[i];
    if (resolved) {
      bundle.resolvedGroups[key] = resolved;
      bundle.groupOptions.push({ key, name: resolved.groupName });
    }
  });

  if (enrichedHoldingsPromise) {
    bundle.holdings = buildHoldingsInventory(
      await enrichedHoldingsPromise,
      new Map(acctRows.map((a) => [a.id, { name: a.name, category: a.category }])),
    );
  }

  return bundle;
}
