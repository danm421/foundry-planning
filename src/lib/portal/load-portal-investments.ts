// src/lib/portal/load-portal-investments.ts
//
// Server loader for the portal Investments page. For one client it assembles,
// per investment account: value (Σ holdingMarketValue), the account's snapshot
// series, its asset-class allocations, and its holdings list — plus an overall
// value-weighted allocation blend and a total snapshot series.
//
// Investment accounts = base-scenario, portal-visible accounts whose category
// is taxable/retirement OR that have ≥1 holding.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, scenarios, clients, assetClasses } from "@/db/schema";
import { loadEnrichedHoldings } from "@/lib/investments/load-enriched-holdings";
import {
  rollupHoldings,
  firmSlugToAssetClassId,
  holdingMarketValue,
  type HoldingInput,
} from "@/lib/investments/holdings-rollup";
import { loadInvestmentSeries } from "@/lib/investments/value-snapshots";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import type { PortalInvestmentAccount, PortalInvestmentsData } from "@/lib/portal/contracts";

export type { PortalInvestmentAccount, PortalInvestmentsData } from "@/lib/portal/contracts";

const INVESTMENT_CATEGORIES = new Set(["taxable", "retirement"]);

export async function loadPortalInvestments(
  clientId: string,
): Promise<PortalInvestmentsData> {
  const [client] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);
  if (!client || !scenario) {
    return { totalValue: 0, totalSeries: [], accounts: [], overallAllocations: [] };
  }

  const acctRows = (
    await db
      .select({
        id: accounts.id,
        name: accounts.name,
        category: accounts.category,
        last4: accounts.accountNumberLast4,
        isDefaultChecking: accounts.isDefaultChecking,
        parentAccountId: accounts.parentAccountId,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)))
  ).filter((r) =>
    isPortalVisibleAccount({
      category: r.category,
      isDefaultChecking: r.isDefaultChecking,
      parentAccountId: r.parentAccountId,
    }),
  );

  const enriched = await loadEnrichedHoldings(acctRows.map((a) => a.id));
  const invAccts = acctRows.filter(
    (a) => INVESTMENT_CATEGORIES.has(a.category) || (enriched.get(a.id)?.length ?? 0) > 0,
  );
  const invIds = invAccts.map((a) => a.id);

  const acRows = await db
    .select({
      id: assetClasses.id,
      slug: assetClasses.slug,
      name: assetClasses.name,
      firmId: assetClasses.firmId,
    })
    .from(assetClasses)
    .where(eq(assetClasses.firmId, client.firmId));
  const slugToId = firmSlugToAssetClassId(acRows, client.firmId);
  const nameById = new Map(acRows.map((r) => [r.id, r.name]));

  const { perAccount, total } = await loadInvestmentSeries(invIds);

  const toInputs = (rows: NonNullable<ReturnType<typeof enriched.get>>): HoldingInput[] =>
    rows.map((h) => ({
      id: h.id,
      securityId: h.securityId,
      shares: Number(h.shares),
      price: Number(h.price),
      costBasis: Number(h.costBasis),
      marketValue: h.marketValue != null ? Number(h.marketValue) : null,
      securityWeights: h.securityWeights,
      overrides: h.overrides,
    }));

  const accounts_ = invAccts
    .map((a): PortalInvestmentAccount => {
      const rows = enriched.get(a.id) ?? [];
      const rollup = rollupHoldings(toInputs(rows), slugToId);
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        last4: a.last4,
        value: rollup.value,
        series: perAccount.get(a.id) ?? [],
        allocations: rollup.allocations.map((x) => ({
          name: nameById.get(x.assetClassId) ?? "Other",
          weight: x.weight,
        })),
        holdings: rows
          .map((h) => ({
            ticker: h.displayTicker,
            name: h.displayName ?? h.displayTicker ?? "—",
            shares: Number(h.shares),
            price: Number(h.price),
            marketValue: holdingMarketValue({
              marketValue: h.marketValue != null ? Number(h.marketValue) : null,
              shares: Number(h.shares),
              price: Number(h.price),
            }),
            costBasis: h.costBasis != null ? Number(h.costBasis) : null,
          }))
          .sort((x, y) => y.marketValue - x.marketValue),
      };
    })
    .sort((x, y) => y.value - x.value);

  // Overall allocation = value-weighted blend across all investment holdings.
  const allInputs = invIds.flatMap((id) => toInputs(enriched.get(id) ?? []));
  const overall = rollupHoldings(allInputs, slugToId);

  return {
    totalValue: accounts_.reduce((s, a) => s + a.value, 0),
    totalSeries: total,
    accounts: accounts_,
    overallAllocations: overall.allocations.map((x) => ({
      name: nameById.get(x.assetClassId) ?? "Other",
      weight: x.weight,
    })),
  };
}
