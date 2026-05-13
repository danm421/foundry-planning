// src/lib/comparison/load-allocation-for-plan.ts
//
// Loads a HouseholdAllocation for one comparison plan. Mirrors the canonical
// query/resolver wiring in the investments page (src/app/(app)/clients/[id]/
// assets/investments/page.tsx) — we always read from the BASE scenario since
// overrides inherit base asset-class assignments.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarios as scenariosTable,
  planSettings as planSettingsTable,
  accounts as accountsTable,
  accountOwners,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  modelPortfolioAllocations,
  entities as entitiesTable,
} from "@/db/schema";
import type { LoadedProjection } from "@/lib/scenario/load-projection-for-ref";
import {
  resolveAccountAllocation,
  computeHouseholdAllocation,
  type InvestableAccount,
  type AccountLite,
  type PlanSettingsLite,
  type AssetClassLite,
  type HouseholdAllocation,
} from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { AssetTypeId } from "@/lib/investments/asset-types";

export interface LoadAllocationArgs {
  clientId: string;
  firmId: string;
  loaded: LoadedProjection;
}

/**
 * Compute the household allocation for the given comparison plan. Returns null
 * when the client has no investable accounts or when base-scenario plan
 * settings are missing.
 *
 * We deliberately always query the BASE scenario for the underlying
 * accounts / asset-class assignments / model-portfolio config: scenario
 * overrides inherit base assignments, so the allocation surface is
 * effectively a household-level (not per-scenario) view.
 */
export async function loadAllocationForPlan(
  args: LoadAllocationArgs,
): Promise<HouseholdAllocation | null> {
  const { clientId, firmId, loaded } = args;

  // Early bail: nothing to allocate.
  if (!loaded.tree.accounts || loaded.tree.accounts.length === 0) return null;

  // Resolve the BASE scenario for this client.
  const [scenario] = await db
    .select({ id: scenariosTable.id })
    .from(scenariosTable)
    .where(
      and(
        eq(scenariosTable.clientId, clientId),
        eq(scenariosTable.isBaseCase, true),
      ),
    );
  if (!scenario) return null;

  const [settings] = await db
    .select()
    .from(planSettingsTable)
    .where(
      and(
        eq(planSettingsTable.clientId, clientId),
        eq(planSettingsTable.scenarioId, scenario.id),
      ),
    );
  if (!settings) return null;

  // Firm scoping note (mirrors investments page): account_asset_allocations
  // and model_portfolio_allocations have no firm_id columns. We firm-scope
  // transitively by filtering accounts on (clientId + base scenarioId) and
  // asset classes on firmId, then intersecting allocations with those id sets.
  const [acctRows, mixRows, classRows, portfolioAllocRows, entityRows] =
    await Promise.all([
      db
        .select()
        .from(accountsTable)
        .where(
          and(
            eq(accountsTable.clientId, clientId),
            eq(accountsTable.scenarioId, scenario.id),
          ),
        ),
      db.select().from(accountAssetAllocations),
      db
        .select()
        .from(assetClassesTable)
        .where(eq(assetClassesTable.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db
        .select({
          id: entitiesTable.id,
          includeInPortfolio: entitiesTable.includeInPortfolio,
        })
        .from(entitiesTable)
        .where(eq(entitiesTable.clientId, clientId)),
    ]);

  if (acctRows.length === 0) return null;

  const entityIncludeInPortfolio = new Map<string, boolean>();
  for (const e of entityRows) entityIncludeInPortfolio.set(e.id, e.includeInPortfolio);

  // Build entity-ownership map from the junction table (replaces dropped
  // ownerEntityId column).
  const accountEntityOwner = new Map<string, string>();
  const acctIds = acctRows.map((a) => a.id);
  const ownerRows = await db
    .select({
      accountId: accountOwners.accountId,
      entityId: accountOwners.entityId,
    })
    .from(accountOwners)
    .where(inArray(accountOwners.accountId, acctIds));
  for (const row of ownerRows) {
    if (row.entityId != null) accountEntityOwner.set(row.accountId, row.entityId);
  }

  // Index asset allocations by account id (filter to this client's accounts).
  const accountIds = new Set(acctIds);
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  // Index model portfolio allocations by portfolio id.
  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> =
    {};
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

  // For the comparison surface we use the "in-estate" view (no
  // includeOutOfEstate toggle): entity-owned accounts are included only when
  // the entity's includeInPortfolio flag is true.
  const investable: InvestableAccount[] = acctRows.map((a) => {
    const entityId = accountEntityOwner.get(a.id) ?? null;
    const entityInPortfolio =
      entityId !== null && (entityIncludeInPortfolio.get(entityId) ?? false);
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      growthSource: a.growthSource,
      modelPortfolioId: a.modelPortfolioId ?? null,
      value: Number(a.value),
      ownerEntityId: entityId,
      ownerEntityInPortfolio: entityId !== null && entityInPortfolio,
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
    resolveAccountAllocation(
      acct,
      accountMixByAccountId,
      modelPortfolioAllocationsByPortfolioId,
      planLite,
      cashAssetClassId,
    );

  return computeHouseholdAllocation(investable, resolver, assetClassLites);
}
