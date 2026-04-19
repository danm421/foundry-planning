import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  modelPortfolios,
  modelPortfolioAllocations,
  reportComments,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
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
  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, commentRows] = await Promise.all([
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
  ]);

  const existingCommentBody = commentRows[0]?.body ?? "";

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

  const investableAccounts: InvestableAccount[] = acctRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    value: Number(a.value),
    ownerEntityId: a.ownerEntityId ?? null,
  }));

  const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    assetType: c.assetType as AssetTypeId,
  }));

  const cashAssetClassId = classRows.find((c) => c.slug === "cash")?.id ?? null;

  const household = computeHouseholdAllocation(
    investableAccounts,
    (acct: AccountLite) =>
      resolveAccountAllocation(acct, accountMixByAccountId, modelPortfolioAllocationsByPortfolioId, planLite, cashAssetClassId),
    assetClassLites,
  );

  const portfolioLites = portfolioRows.map((p) => ({ id: p.id, name: p.name }));
  const benchmark = resolveBenchmark(
    settings.selectedBenchmarkPortfolioId ?? null,
    portfolioLites,
    modelPortfolioAllocationsByPortfolioId,
  );

  const nameByClassId: Record<string, string> = {};
  for (const c of classRows) nameByClassId[c.id] = c.name;
  const drift = benchmark ? computeDrift(household.byAssetClass, benchmark, nameByClassId) : [];

  return (
    <InvestmentsClient
      clientId={clientId}
      household={household}
      drift={drift}
      assetClasses={assetClassLites}
      modelPortfolios={portfolioLites}
      selectedBenchmarkPortfolioId={settings.selectedBenchmarkPortfolioId ?? null}
      benchmarkWeights={benchmark ?? []}
      existingCommentBody={existingCommentBody}
    />
  );
}
