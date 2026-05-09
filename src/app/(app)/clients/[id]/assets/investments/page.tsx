import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountOwners,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  modelPortfolios,
  modelPortfolioAllocations,
  reportComments,
  entities as entitiesTable,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import {
  resolveAccountAllocation,
  computeHouseholdAllocation,
  computeDrift,
  type InvestableAccount,
  type AccountLite,
  type PlanSettingsLite,
  type AssetClassLite,
} from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import InvestmentsClient from "./investments-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InvestmentsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id: clientId } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) notFound();

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
  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, commentRows, entityRows] = await Promise.all([
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

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: settings.growthSourceTaxable,
    growthSourceCash: settings.growthSourceCash,
    growthSourceRetirement: settings.growthSourceRetirement,
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };

  const buildAccounts = (includeOutOfEstate: boolean): InvestableAccount[] =>
    acctRows.map((a) => {
      const entityId = accountEntityOwner.get(a.id) ?? null;
      const entityInPortfolio = entityId !== null && (entityIncludeInPortfolio.get(entityId) ?? false);
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        growthSource: a.growthSource,
        modelPortfolioId: a.modelPortfolioId ?? null,
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
    resolveAccountAllocation(acct, accountMixByAccountId, modelPortfolioAllocationsByPortfolioId, planLite, cashAssetClassId);

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
    />
  );
}
