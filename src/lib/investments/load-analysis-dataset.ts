import { db } from "@/db";
import {
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  assetClassCorrelations,
  accountGroups,
  accountGroupMembers,
  modelPortfolios,
  modelPortfolioAllocations,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  resolveAccountAllocation,
  toGrowthSource,
  type AccountLite,
  type PlanSettingsLite,
} from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import { buildStatsContext } from "@/lib/investments/portfolio-stats";
import {
  assembleAnalysisDataset,
  type PortfolioAnalysisDataset,
} from "@/lib/investments/analysis-dataset";

export async function loadAnalysisDataset(
  clientId: string,
  firmId: string,
): Promise<PortfolioAnalysisDataset | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) return null;

  const [settings] = await db
    .select()
    .from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id)));
  if (!settings) return null;

  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, groupRows] =
    await Promise.all([
      db
        .select()
        .from(accountsTable)
        .where(
          and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id)),
        ),
      db.select().from(accountAssetAllocations),
      db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db.select().from(accountGroups).where(eq(accountGroups.clientId, clientId)),
    ]);

  // Correlations fetched unfiltered; buildStatsContext/buildCorrelationMatrix
  // drops any pair whose id isn't in this firm's class list (same drop-on-build
  // firm scoping investments-content uses).
  const correlationRows = await db
    .select({
      assetClassIdA: assetClassCorrelations.assetClassIdA,
      assetClassIdB: assetClassCorrelations.assetClassIdB,
      correlation: assetClassCorrelations.correlation,
    })
    .from(assetClassCorrelations);

  const accountIds = new Set(acctRows.map((a) => a.id));
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const row of portfolioAllocRows) {
    (modelPortfolioAllocationsByPortfolioId[row.modelPortfolioId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  const slugToAssetClassId = new Map<string, string>();
  for (const ac of classRows) if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);
  const tickerAllocRows = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);
  const tickerPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const r of tickerAllocRows)
    (tickerPortfolioAllocationsByPortfolioId[r.tickerPortfolioId] ??= []).push({
      assetClassId: r.assetClassId,
      weight: parseFloat(r.weight),
    });

  const memberIdsByGroup = new Map<string, string[]>();
  if (groupRows.length > 0) {
    const groupIds = groupRows.map((g) => g.id);
    const memberRows = await db
      .select({
        accountGroupId: accountGroupMembers.accountGroupId,
        accountId: accountGroupMembers.accountId,
      })
      .from(accountGroupMembers)
      .where(inArray(accountGroupMembers.accountGroupId, groupIds));
    for (const row of memberRows) {
      (
        memberIdsByGroup.get(row.accountGroupId) ??
        memberIdsByGroup.set(row.accountGroupId, []).get(row.accountGroupId)!
      ).push(row.accountId);
    }
  }

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: toGrowthSource(settings.growthSourceTaxable),
    growthSourceCash: toGrowthSource(settings.growthSourceCash),
    growthSourceRetirement: toGrowthSource(settings.growthSourceRetirement),
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };
  const cashAssetClassId = classRows.find((c) => c.slug === "cash")?.id ?? null;

  const resolver = (acct: AccountLite) =>
    resolveAccountAllocation(
      acct,
      accountMixByAccountId,
      modelPortfolioAllocationsByPortfolioId,
      planLite,
      cashAssetClassId,
      tickerPortfolioAllocationsByPortfolioId,
    );

  const assetClassData = classRows.map((c) => ({
    id: c.id,
    arithmeticMean: Number(c.arithmeticMean),
    geometricReturn: Number(c.geometricReturn),
    volatility: Number(c.volatility),
    pctOrdinaryIncome: Number(c.pctOrdinaryIncome),
    pctLtCapitalGains: Number(c.pctLtCapitalGains),
    pctQualifiedDividends: Number(c.pctQualifiedDividends),
    pctTaxExempt: Number(c.pctTaxExempt),
  }));
  const assetClassMeta = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    assetType: c.assetType as AssetTypeId,
  }));
  const riskFreeRate = Number(classRows.find((c) => c.slug === "cash")?.arithmeticMean ?? 0);
  const ctx = buildStatsContext(assetClassData, correlationRows, riskFreeRate);

  const analysisAccounts = acctRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    value: Number(a.value),
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    tickerPortfolioId: a.tickerPortfolioId ?? null,
  }));

  return assembleAnalysisDataset({
    assetClassMeta,
    assetClassData,
    ctx,
    accounts: analysisAccounts,
    resolver: resolver as (acct: { id: string }) => ReturnType<typeof resolver>,
    modelPortfolios: portfolioRows.map((p) => ({ id: p.id, name: p.name })),
    modelPortfolioAllocationsByPortfolioId,
    customGroups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      accountIds: memberIdsByGroup.get(g.id) ?? [],
    })),
  });
}
