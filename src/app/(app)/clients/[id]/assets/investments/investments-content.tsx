import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountOwners,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  assetClassCorrelations,
  accountGroupMembers,
  modelPortfolios,
  modelPortfolioAllocations,
  reportComments,
  entities as entitiesTable,
  tickerPortfolios as tickerPortfoliosTable,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  resolveAccountAllocation,
  computeHouseholdAllocation,
  computeDrift,
  toGrowthSource,
  type InvestableAccount,
  type AccountLite,
  type PlanSettingsLite,
  type AssetClassLite,
} from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import { loadEnrichedHoldings } from "@/lib/investments/load-enriched-holdings";
import { breakdownHoldingsByClass, type HoldingClassContribution } from "@/lib/investments/holdings-rollup";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import { resolveGroup, type GroupKey } from "@/lib/account-groups/resolver";
import { fetchAccountGroupForResolver, listAccountGroups } from "@/lib/account-groups/queries";
import { buildStatsContext } from "@/lib/investments/portfolio-stats";
import { buildAnalysisRows } from "@/lib/investments/portfolio-analysis";
import InvestmentsClient from "./investments-client";

interface Props {
  clientId: string;
  firmId: string;
  groupKey: string;
}

export async function InvestmentsContent({ clientId, firmId, groupKey }: Props) {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) notFound();

  const [settings] = await db
    .select()
    .from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id)));
  if (!settings) notFound();

  // Firm scoping note: account_asset_allocations and model_portfolio_allocations
  // have no firm_id columns of their own. We firm-scope transitively by filtering
  // accounts by (clientId + scenarioId) and model_portfolios by firmId, then
  // intersecting allocations with those id sets when we build the indexes below.
  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, commentRows, entityRows, correlationRows] = await Promise.all([
    db.select().from(accountsTable).where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id))),
    db.select().from(accountAssetAllocations),
    db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(reportComments).where(and(
      eq(reportComments.clientId, clientId),
      eq(reportComments.scenarioId, scenario.id),
      eq(reportComments.reportKey, "investments_asset_allocation"),
    )),
    db.select({ id: entitiesTable.id, includeInPortfolio: entitiesTable.includeInPortfolio })
      .from(entitiesTable)
      .where(eq(entitiesTable.clientId, clientId)),
    // Correlation rows are fetched unfiltered here because classRows (which carries
    // the firm's asset-class ids) is resolved by this same Promise.all and its ids
    // aren't known at query-build time. Firm scoping is applied on use:
    // buildCorrelationMatrix silently drops any pair whose A- or B-side id is not in
    // the firm's class list — the same drop-on-build scoping used for mixRows above.
    db.select({
      assetClassIdA: assetClassCorrelations.assetClassIdA,
      assetClassIdB: assetClassCorrelations.assetClassIdB,
      correlation: assetClassCorrelations.correlation,
    }).from(assetClassCorrelations),
  ]);

  const entityIncludeInPortfolio = new Map<string, boolean>();
  for (const e of entityRows) entityIncludeInPortfolio.set(e.id, e.includeInPortfolio);

  const existingCommentBody = commentRows[0]?.body ?? "";

  // Build entity ownership map from junction table (replaces dropped ownerEntityId column).
  const accountEntityOwner = new Map<string, string>();
  if (acctRows.length > 0) {
    const acctIds = acctRows.map((a) => a.id);
    const ownerRows = await db
      .select({ accountId: accountOwners.accountId, entityId: accountOwners.entityId })
      .from(accountOwners)
      .where(inArray(accountOwners.accountId, acctIds));
    for (const row of ownerRows) {
      if (row.entityId != null) accountEntityOwner.set(row.accountId, row.entityId);
    }
  }

  const resolverDeps = {
    fetchAccounts: async () =>
      acctRows.map((a) => ({ id: a.id, category: a.category })),
    fetchCustomGroup: (cid: string, gid: string) =>
      fetchAccountGroupForResolver(cid, gid),
  };

  // resolveGroup and listAccountGroups are independent — run in parallel.
  // A custom group can be deleted out from under a stale ?group= URL; in that
  // case resolveGroup throws, so fall back to the all-liquid view instead of
  // crashing the page.
  const [resolvedGroupOrNull, customGroupRows] = await Promise.all([
    resolveGroup(clientId, groupKey as GroupKey, resolverDeps).catch(() => null),
    listAccountGroups(clientId),
  ]);
  const resolvedGroup =
    resolvedGroupOrNull ?? (await resolveGroup(clientId, "all-liquid", resolverDeps));
  const groupAccountIdSet = new Set(resolvedGroup.accountIds);

  const customGroupsForBar = customGroupRows.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
  }));

  // Load account group membership for portfolio-analysis (custom groups need their
  // member account ids). Scoped via the group ids we already loaded (which are
  // themselves client-scoped via listAccountGroups).
  const memberIdsByGroup = new Map<string, string[]>();
  if (customGroupRows.length > 0) {
    const groupIds = customGroupRows.map((g) => g.id);
    const memberRows = await db
      .select({ accountGroupId: accountGroupMembers.accountGroupId, accountId: accountGroupMembers.accountId })
      .from(accountGroupMembers)
      .where(inArray(accountGroupMembers.accountGroupId, groupIds));
    for (const row of memberRows) {
      (memberIdsByGroup.get(row.accountGroupId) ?? memberIdsByGroup.set(row.accountGroupId, []).get(row.accountGroupId)!).push(row.accountId);
    }
  }

  // Index asset allocations by account id (filter to this client's accounts).
  const accountIds = new Set(acctRows.map((a) => a.id));
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  // Index model portfolio allocations by portfolio id.
  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const row of portfolioAllocRows) {
    (modelPortfolioAllocationsByPortfolioId[row.modelPortfolioId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  // Fold this firm's fund (ticker) portfolios into asset-class weight rows, keyed
  // by portfolio id, so ticker_portfolio accounts classify in the household view.
  const slugToAssetClassId = new Map<string, string>();
  for (const ac of classRows) if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);
  const tickerAllocRows = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);
  const tickerPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const r of tickerAllocRows)
    (tickerPortfolioAllocationsByPortfolioId[r.tickerPortfolioId] ??= []).push({
      assetClassId: r.assetClassId,
      weight: parseFloat(r.weight),
    });

  // Holdings-driven accounts (growth_source === "asset_mix" with real holdings) can
  // be expanded in the class drill to show the underlying positions. Build a
  // per-account, per-class breakdown using the same blend logic as the rollup.
  const assetMixAccountIds = acctRows
    .filter((a) => toGrowthSource(a.growthSource) === "asset_mix")
    .map((a) => a.id);
  const enrichedByAccount = await loadEnrichedHoldings(assetMixAccountIds);

  // accounts that actually hold individual securities, with a market-value total
  const accountsWithHoldings = acctRows
    .filter((a) => enrichedByAccount.has(a.id))
    .map((a) => {
      const rows = enrichedByAccount.get(a.id)!;
      const value = rows.reduce((s, h) => s + Number(h.shares) * Number(h.price), 0);
      return { id: a.id, name: a.name, category: a.category, value };
    });

  const fundPortfolios = (
    await db
      .select({ id: tickerPortfoliosTable.id, name: tickerPortfoliosTable.name })
      .from(tickerPortfoliosTable)
      .where(eq(tickerPortfoliosTable.firmId, firmId))
  ).map((p) => ({ id: p.id, name: p.name }));

  const holdingsByAccountClass: Record<string, Record<string, HoldingClassContribution[]>> = {};
  for (const [accountId, enriched] of enrichedByAccount) {
    const positions = enriched.map((e) => ({
      id: e.id,
      ticker: e.displayTicker ?? "",
      name: e.displayName ?? "",
      securityId: e.securityId,
      shares: Number(e.shares),
      price: Number(e.price),
      marketValue: e.marketValue != null ? parseFloat(e.marketValue) : null,
      securityWeights: e.securityWeights,
      overrides: e.overrides,
    }));
    const byClass = breakdownHoldingsByClass(positions, slugToAssetClassId);
    if (byClass.size === 0) continue;
    holdingsByAccountClass[accountId] = Object.fromEntries(byClass);
  }

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: toGrowthSource(settings.growthSourceTaxable),
    growthSourceCash: toGrowthSource(settings.growthSourceCash),
    growthSourceRetirement: toGrowthSource(settings.growthSourceRetirement),
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };

  const buildAccounts = (includeOutOfEstate: boolean): InvestableAccount[] =>
    acctRows
      .filter((a) => groupAccountIdSet.has(a.id))
      .map((a) => {
      const entityId = accountEntityOwner.get(a.id) ?? null;
      const entityInPortfolio = entityId !== null && (entityIncludeInPortfolio.get(entityId) ?? false);
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        growthSource: toGrowthSource(a.growthSource),
        modelPortfolioId: a.modelPortfolioId ?? null,
        tickerPortfolioId: a.tickerPortfolioId ?? null,
        value: Number(a.value),
        ownerEntityId: entityId,
        // When includeOutOfEstate is on, force entity-owned accounts to pass the
        // filter regardless of the entity's includeInPortfolio flag.
        ownerEntityInPortfolio: entityId !== null && (includeOutOfEstate || entityInPortfolio),
      };
    });

  const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    assetType: c.assetType as AssetTypeId,
  }));

  const cashAssetClassId = classRows.find((c) => c.slug === "cash")?.id ?? null;

  const resolver = (acct: AccountLite) =>
    resolveAccountAllocation(acct, accountMixByAccountId, modelPortfolioAllocationsByPortfolioId, planLite, cashAssetClassId, tickerPortfolioAllocationsByPortfolioId);

  const householdInEstate = computeHouseholdAllocation(buildAccounts(false), resolver, assetClassLites);
  const householdAll = computeHouseholdAllocation(buildAccounts(true), resolver, assetClassLites);

  const portfolioLites = portfolioRows.map((p) => ({ id: p.id, name: p.name }));
  const benchmark = resolveBenchmark(
    settings.selectedBenchmarkPortfolioId ?? null,
    portfolioLites,
    modelPortfolioAllocationsByPortfolioId,
  );

  const nameByClassId: Record<string, string> = {};
  for (const c of classRows) nameByClassId[c.id] = c.name;
  const driftInEstate = benchmark ? computeDrift(householdInEstate.byAssetClass, benchmark, nameByClassId) : [];
  const driftAll = benchmark ? computeDrift(householdAll.byAssetClass, benchmark, nameByClassId) : [];

  // Build portfolio-analysis rows (risk/return scatter data).
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
  const riskFreeRate = Number(classRows.find((c) => c.slug === "cash")?.arithmeticMean ?? 0);
  const statsCtx = buildStatsContext(assetClassData, correlationRows, riskFreeRate);
  const analysisAccounts = acctRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    value: Number(a.value),
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    tickerPortfolioId: a.tickerPortfolioId ?? null,
  }));
  const { rows: analysisRows } = buildAnalysisRows({
    assetClasses: assetClassData,
    assetClassMeta: assetClassLites,
    accounts: analysisAccounts,
    // AnalysisAccount carries all fields the resolver reads at runtime; this cast
    // aligns its declared parameter type with BuildAnalysisInput's looser { id }
    // signature.
    resolver: resolver as (acct: { id: string }) => ReturnType<typeof resolver>,
    modelPortfolios: portfolioLites,
    modelPortfolioAllocationsByPortfolioId,
    customGroups: customGroupRows.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      accountIds: memberIdsByGroup.get(g.id) ?? [],
    })),
    ctx: statsCtx,
  });

  return (
    <InvestmentsClient
      clientId={clientId}
      household={householdInEstate}
      householdAll={householdAll}
      drift={driftInEstate}
      driftAll={driftAll}
      assetClasses={assetClassLites}
      modelPortfolios={portfolioLites}
      selectedBenchmarkPortfolioId={settings.selectedBenchmarkPortfolioId ?? null}
      benchmarkWeights={benchmark ?? []}
      existingCommentBody={existingCommentBody}
      selectedGroupKey={resolvedGroup.groupKey}
      selectedGroupIsDefault={resolvedGroup.isDefault}
      customGroups={customGroupsForBar}
      strippedMemberCount={resolvedGroup.strippedMemberCount}
      analysisRows={analysisRows}
      holdingsByAccountClass={holdingsByAccountClass}
      accountsWithHoldings={accountsWithHoldings}
      fundPortfolios={fundPortfolios}
    />
  );
}
