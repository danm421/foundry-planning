import {
  resolveAccountAllocation,
  type AccountLite,
  type AccountAllocationResult,
  type PlanSettingsLite,
  type AssetClassLite,
  type GrowthSource,
} from "@/lib/investments/allocation";
import type { AssetClassWeight, ModelPortfolioLite } from "@/lib/investments/benchmarks";
import type { ResolverDeps, ResolvedGroup } from "@/lib/account-groups/resolver";

/** One investable account, carrying everything both view-models need. */
export interface BundleAccount {
  id: string;
  name: string;
  category: AccountLite["category"];
  growthSource: GrowthSource;
  modelPortfolioId: string | null;
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
  planLite: PlanSettingsLite;
  portfolioLites: ModelPortfolioLite[];
  selectedBenchmarkPortfolioId: string | null;
  customGroups: { id: string; name: string; color: string | null; accountIds: string[] }[];
  /** Pre-resolved at load time (keeps buildData synchronous). Keyed by group key. */
  resolvedGroups: Record<string, ResolvedGroup>;
  /** Selectable groups for the builder UI dropdown, in display order. */
  groupOptions: { key: string; name: string }[];
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
import type { AssetTypeId } from "@/lib/investments/asset-types";

/**
 * Load the full investments bundle for a client (base-case scenario). Pre-resolves
 * every selectable group so view-models stay synchronous. Mirrors the load logic
 * in investments-content.tsx. Returns null when the client has no base-case scenario/settings.
 */
export async function loadInvestmentsBundle(
  clientId: string,
  firmId: string,
): Promise<InvestmentsBundle | null> {
  const [scenario] = await db.select().from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return null;

  const [settings] = await db.select().from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id)));
  if (!settings) return null;

  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, entityRows, correlationRows] =
    await Promise.all([
      db.select().from(accountsTable).where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id))),
      db.select().from(accountAssetAllocations),
      db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db.select({ id: entitiesTable.id, includeInPortfolio: entitiesTable.includeInPortfolio })
        .from(entitiesTable).where(eq(entitiesTable.clientId, clientId)),
      db.select({
        assetClassIdA: assetClassCorrelations.assetClassIdA,
        assetClassIdB: assetClassCorrelations.assetClassIdB,
        correlation: assetClassCorrelations.correlation,
      }).from(assetClassCorrelations),
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

  const customGroupRows = await listAccountGroups(clientId);

  const accounts: BundleAccount[] = acctRows.map((a) => {
    const entityId = accountEntityOwner.get(a.id) ?? null;
    return {
      id: a.id, name: a.name, category: a.category, growthSource: a.growthSource,
      modelPortfolioId: a.modelPortfolioId ?? null, value: Number(a.value),
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
  const cashAssetClassId = classRows.find((c) => c.slug === "cash")?.id ?? null;
  const riskFreeRate = Number(classRows.find((c) => c.slug === "cash")?.arithmeticMean ?? 0);

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: settings.growthSourceTaxable,
    growthSourceCash: settings.growthSourceCash,
    growthSourceRetirement: settings.growthSourceRetirement,
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
    accountMixByAccountId, modelPortfolioAllocationsByPortfolioId, planLite,
    portfolioLites: portfolioRows.map((p) => ({ id: p.id, name: p.name })),
    selectedBenchmarkPortfolioId: settings.selectedBenchmarkPortfolioId ?? null,
    customGroups,
    resolvedGroups: {},
    groupOptions: [],
  };

  // Pre-resolve every selectable group (default keys + custom groups).
  const deps = bundleGroupDeps(bundle);
  const keys: GroupKey[] = [...DEFAULT_GROUP_KEYS, ...customGroups.map((g) => g.id)];
  for (const key of keys) {
    const resolved = await resolveGroup(clientId, key, deps).catch(() => null);
    if (resolved) {
      bundle.resolvedGroups[key] = resolved;
      bundle.groupOptions.push({ key, name: resolved.groupName });
    }
  }
  return bundle;
}
