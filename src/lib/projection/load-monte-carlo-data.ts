import { cache } from "react";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  accountOwners,
  planSettings,
  entities,
  modelPortfolioAllocations,
  assetClasses,
  accountAssetAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { buildCorrelationMatrix } from "@/engine/monteCarlo/correlation-matrix";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { IndexInput } from "@/engine/monteCarlo/returns";
import { ClientNotFoundError, ProjectionInputError } from "./load-client-data";

export type MonteCarloPayload = {
  indices: IndexInput[];
  correlation: number[][];
  accountMixes: Array<{ accountId: string; mix: AccountAssetMix[] }>;
  startingLiquidBalance: number;
  seed: number;
  requiredMinimumAssetLevel: number;
};

// Fresh seed in the signed-int32 range — well within PostgreSQL's `integer` column.
function generateSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export const loadMonteCarloData = cache(
  async (clientId: string, firmId: string): Promise<MonteCarloPayload> => {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
    if (!client) throw new ClientNotFoundError(clientId);

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    if (!scenario) throw new ProjectionInputError(`Client ${clientId} has no base case scenario`);

    const id = clientId;

    const [
      accountRows,
      settingsRow,
      entityRows,
      assetClassRows,
      accountAllocationRows,
      portfolioAllocationRows,
      correlationRows,
      accountOwnerRows,
    ] = await Promise.all([
      db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
      db.select().from(planSettings).where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))).limit(1),
      db.select().from(entities).where(eq(entities.clientId, id)),
      db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
      db.select().from(accountAssetAllocations),
      db.select().from(modelPortfolioAllocations),
      db
        .select()
        .from(assetClassCorrelations)
        .innerJoin(assetClasses, eq(assetClassCorrelations.assetClassIdA, assetClasses.id))
        .where(eq(assetClasses.firmId, firmId)),
      db.select().from(accountOwners),
    ]);
    const settings = settingsRow[0];
    if (!settings) throw new ProjectionInputError(`Client ${clientId} has no plan settings`);

    // ── Resolve per-account mixes ───────────────────────────────────────────
    // Per PDF p.6/p.7: custom rates, inflation-linked rates, and non-investable
    // categories don't randomize. We randomize accounts whose effective growth
    // source resolves to asset_mix or model_portfolio — including accounts on
    // "default" that inherit a category default that points to one of those.
    const allocsByAccount = new Map<string, typeof accountAllocationRows>();
    for (const a of accountAllocationRows) {
      const list = allocsByAccount.get(a.accountId) ?? [];
      list.push(a);
      allocsByAccount.set(a.accountId, list);
    }
    const allocsByPortfolio = new Map<string, typeof portfolioAllocationRows>();
    for (const a of portfolioAllocationRows) {
      const list = allocsByPortfolio.get(a.modelPortfolioId) ?? [];
      list.push(a);
      allocsByPortfolio.set(a.modelPortfolioId, list);
    }

    // Entity filter for "in estate" — matches projection engine's portfolio-asset rule.
    const entityInPortfolio = new Map<string, boolean>();
    for (const e of entityRows) entityInPortfolio.set(e.id, e.includeInPortfolio);
    // Build per-account entity ownership from the junction table.
    const accountEntityOwner = new Map<string, string | null>();
    for (const row of accountOwnerRows) {
      if (row.entityId != null) accountEntityOwner.set(row.accountId, row.entityId);
    }
    const accountInEstate = (a: typeof accountRows[number]): boolean => {
      const entityId = accountEntityOwner.get(a.id) ?? null;
      return entityId == null || entityInPortfolio.get(entityId) === true;
    };

    // Per-category default growth source + model portfolio from plan_settings.
    // Only the three investable categories have category-level defaults.
    const categoryDefault = (category: string): { source: string; portfolioId: string | null } => {
      if (category === "taxable") return { source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable };
      if (category === "cash") return { source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash };
      if (category === "retirement") return { source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement };
      return { source: "custom", portfolioId: null };
    };

    const accountMixes: Array<{ accountId: string; mix: AccountAssetMix[] }> = [];
    for (const acct of accountRows) {
      // Skip non-investable categories (per PDF: real estate/business/life insurance
      // don't participate in MC — they use their fixed rates).
      if (acct.category === "real_estate" || acct.category === "business" || acct.category === "life_insurance") continue;
      if (!accountInEstate(acct)) continue;

      // Mirror the deterministic resolver in projection-data/route.ts:
      //   - "asset_mix" or "model_portfolio" on the account → use as-is.
      //   - "default" → look up the category-level default in plan_settings;
      //     if that default is asset_mix/model_portfolio, use the same path.
      //   - Anything else (custom, inflation, or default→custom/inflation) →
      //     no mix → MC falls back to the fixed deterministic growth rate.
      let effectiveSource: string = acct.growthSource ?? "default";
      let effectivePortfolioId: string | null = acct.modelPortfolioId ?? null;
      if (effectiveSource === "default") {
        const def = categoryDefault(acct.category);
        effectiveSource = def.source;
        if (effectiveSource === "model_portfolio") effectivePortfolioId = def.portfolioId;
      }

      let mix: AccountAssetMix[] = [];
      if (effectiveSource === "asset_mix") {
        const allocs = allocsByAccount.get(acct.id) ?? [];
        mix = allocs.map((a) => ({ assetClassId: a.assetClassId, weight: parseFloat(a.weight) }));
      } else if (effectiveSource === "model_portfolio" && effectivePortfolioId) {
        const allocs = allocsByPortfolio.get(effectivePortfolioId) ?? [];
        mix = allocs.map((a) => ({ assetClassId: a.assetClassId, weight: parseFloat(a.weight) }));
      }
      if (mix.length > 0) accountMixes.push({ accountId: acct.id, mix });
    }

    // ── Used asset classes ────────────────────────────────────────────────
    const usedIds = new Set<string>();
    for (const { mix } of accountMixes) {
      for (const m of mix) if (m.weight !== 0) usedIds.add(m.assetClassId);
    }

    const indices: IndexInput[] = assetClassRows
      .filter((ac) => usedIds.has(ac.id))
      .map((ac) => ({
        id: ac.id,
        arithMean: parseFloat(ac.arithmeticMean),
        stdDev: parseFloat(ac.volatility),
      }));
    const orderedIds = indices.map((ix) => ix.id);

    // Filter correlation rows to the subset of used asset classes.
    const rawCorrelationRows = correlationRows.map((row) => ({
      assetClassIdA: row.asset_class_correlations.assetClassIdA,
      assetClassIdB: row.asset_class_correlations.assetClassIdB,
      correlation: row.asset_class_correlations.correlation,
    }));
    const correlation = buildCorrelationMatrix(orderedIds, rawCorrelationRows);

    // ── Starting liquid balance (CAGR reference) ─────────────────────────
    let startingLiquidBalance = 0;
    for (const acct of accountRows) {
      if (acct.category !== "taxable" && acct.category !== "cash" && acct.category !== "retirement") continue;
      if (!accountInEstate(acct)) continue;
      startingLiquidBalance += parseFloat(acct.value);
    }

    // ── Seed management ──────────────────────────────────────────────────
    let seed = scenario.monteCarloSeed;
    if (seed == null) {
      seed = generateSeed();
      await db.update(scenarios).set({ monteCarloSeed: seed }).where(eq(scenarios.id, scenario.id));
    }

    return {
      indices,
      correlation,
      accountMixes,
      startingLiquidBalance,
      seed,
      // v1: hardcoded; per-plan setting deferred to FUTURE_WORK.md.
      requiredMinimumAssetLevel: 0,
    };
  },
);
