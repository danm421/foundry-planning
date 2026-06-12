import { cache } from "react";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  scenarios,
  accounts,
  accountOwners,
  accountHoldings,
  holdingAssetClassOverrides,
  securityAssetClassWeights,
  planSettings,
  entities,
  modelPortfolioAllocations,
  assetClasses,
  accountAssetAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import { buildCorrelationMatrix } from "@/engine/monteCarlo/correlation-matrix";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { IndexInput } from "@/engine/monteCarlo/returns";
import { ClientNotFoundError, ProjectionInputError } from "./load-client-data";
import { type HoldingInput } from "@/lib/investments/holdings-rollup";
import { computeHoldingsTotals } from "./holdings-totals";
import type { ClientData } from "@/engine/types";
import {
  computeStartingLiquidBalance,
  type LiquidAccountInput,
} from "./starting-liquid-balance";

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
  async (
    clientId: string,
    firmId: string,
    // Active scenario whose per-scenario MC seed should be used/persisted (F16).
    // IMPORTANT: non-base scenarios are an overlay diff and are NOT physically
    // cloned, so account/mix/volatility/correlation queries stay base-sourced.
    // The seed is read/persisted from the active scenario's own row. When
    // `effectiveTree` is also provided, startingLiquidBalance and the in-estate
    // liquid account set follow the tree (per-scenario). "base", unknown, or
    // the base id => base seed. See the seed block below.
    scenarioId: string | "base" = "base",
    extraAccountMixes: ReadonlyArray<{ accountId: string; mix: AccountAssetMix[] }> = [],
    // Optional per-scenario effective tree. When provided, the in-estate liquid
    // account set + startingLiquidBalance are derived from it (Depth 1).
    // Account MIXES, asset-class volatility, and correlations stay base/firm-
    // sourced (the tree's engine Account drops growthSource/modelPortfolioId).
    // Omitted → byte-identical base behavior.
    effectiveTree?: Pick<ClientData, "accounts" | "entities">,
  ): Promise<MonteCarloPayload> => {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
    if (!client) throw new ClientNotFoundError(clientId);

    // Base scenario drives ALL portfolio data queries below (accounts, plan
    // settings, mixes, correlations). Non-base scenarios are overlay diffs, not
    // physical clones, so these queries only have rows under the base scenario
    // id — mixes & volatility intentionally stay base-sourced. (startingLiquid-
    // Balance is the exception: it follows `effectiveTree` when one is passed.)
    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    if (!scenario) throw new ProjectionInputError(`Client ${clientId} has no base case scenario`);

    // Seed scenario: the per-scenario MC seed lives on each scenario row (F16).
    // When a distinct non-base scenario is active, read/persist the seed off ITS
    // row so each scenario reproduces its own draws. Fall back to the base
    // scenario when the active scenario is "base", is the base case itself, or
    // can't be found. Scoped by clientId (scenarios has no firmId column;
    // clientId was already validated against firmId via the client lookup above).
    let seedScenario = scenario;
    if (scenarioId && scenarioId !== "base" && scenarioId !== scenario.id) {
      const [active] = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)));
      if (active) seedScenario = active;
    }

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

    // ── Holdings-derived starting balances ──────────────────────────────────
    // Accounts driven by their holdings (deriveFromHoldings, ≥1 holding) take
    // their starting value from the rollup, mirroring the deterministic loader.
    // Their mix already resolves via account_asset_allocations (asset_mix path).
    let holdingRows: (typeof accountHoldings.$inferSelect)[] = [];
    if (accountRows.length > 0) {
      holdingRows = await db
        .select()
        .from(accountHoldings)
        .where(inArray(accountHoldings.accountId, accountRows.map((a) => a.id)));
    }
    const holdingIds = holdingRows.map((h) => h.id);
    const securityIds = Array.from(
      new Set(holdingRows.map((h) => h.securityId).filter((s): s is string => s != null)),
    );
    const [holdingOverrideRows, securityWeightRows] = await Promise.all([
      holdingIds.length
        ? db.select().from(holdingAssetClassOverrides)
            .where(inArray(holdingAssetClassOverrides.holdingId, holdingIds))
        : Promise.resolve([]),
      securityIds.length
        ? db.select().from(securityAssetClassWeights)
            .where(inArray(securityAssetClassWeights.securityId, securityIds))
        : Promise.resolve([]),
    ]);
    const slugToAssetClassId = new Map<string, string>();
    for (const ac of assetClassRows) if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);

    // ── Ticker-portfolio look-through mixes ─────────────────────────────────
    const tickerPortfolioAllocations = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);
    const tickerMixByPortfolioId = new Map<string, AccountAssetMix[]>();
    for (const a of tickerPortfolioAllocations) {
      const list = tickerMixByPortfolioId.get(a.tickerPortfolioId) ?? [];
      list.push({ assetClassId: a.assetClassId, weight: parseFloat(a.weight) });
      tickerMixByPortfolioId.set(a.tickerPortfolioId, list);
    }

    const overridesByHolding = new Map<string, { assetClassId: string; weight: number }[]>();
    for (const o of holdingOverrideRows) {
      const list = overridesByHolding.get(o.holdingId) ?? [];
      list.push({ assetClassId: o.assetClassId, weight: parseFloat(o.weight) });
      overridesByHolding.set(o.holdingId, list);
    }
    const weightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
    for (const w of securityWeightRows) {
      const list = weightsBySecurity.get(w.securityId) ?? [];
      list.push({ slug: w.assetClassSlug, weight: parseFloat(w.weight) });
      weightsBySecurity.set(w.securityId, list);
    }
    const holdingsByAccountId = new Map<string, HoldingInput[]>();
    for (const h of holdingRows) {
      const list = holdingsByAccountId.get(h.accountId) ?? [];
      list.push({
        id: h.id,
        securityId: h.securityId,
        shares: parseFloat(h.shares),
        price: parseFloat(h.price),
        costBasis: parseFloat(h.costBasis),
        marketValue: h.marketValue != null ? parseFloat(h.marketValue) : null,
        securityWeights: h.securityId ? weightsBySecurity.get(h.securityId) ?? [] : [],
        overrides: overridesByHolding.get(h.id) ?? [],
      });
      holdingsByAccountId.set(h.accountId, list);
    }
    const holdingsTotalsByAccountId = computeHoldingsTotals({
      accounts: accountRows,
      holdingsByAccountId,
      slugToAssetClassId,
    });

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
      } else if (effectiveSource === "ticker_portfolio" && acct.tickerPortfolioId) {
        mix = tickerMixByPortfolioId.get(acct.tickerPortfolioId) ?? [];
      }
      if (mix.length > 0) accountMixes.push({ accountId: acct.id, mix });
    }

    // LI solver: a synthetic (non-DB) account mix whose asset classes must also
    // feed the indices / correlation matrix below.
    for (const extra of extraAccountMixes) {
      if (extra.mix.length > 0) accountMixes.push({ accountId: extra.accountId, mix: extra.mix });
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
    // Per-scenario when an effectiveTree is supplied: its accounts carry the
    // scenario's values/ownership (added/removed accounts + balance edits).
    // Mixes above stay base-sourced. Holdings rollup stays base-keyed; an added
    // account (no base holdings) falls back to its effective `value`.
    const holdingsValueByAccountId = new Map<string, number>();
    for (const [accountId, totals] of holdingsTotalsByAccountId) {
      holdingsValueByAccountId.set(accountId, totals.value);
    }

    const liquidAccounts: LiquidAccountInput[] = effectiveTree
      ? effectiveTree.accounts.map((a) => ({
          id: a.id,
          category: a.category,
          value: a.value,
          entityId: a.owners.find((o) => o.kind === "entity")?.entityId ?? null,
        }))
      : accountRows.map((a) => ({
          id: a.id,
          category: a.category,
          value: parseFloat(a.value),
          entityId: accountEntityOwner.get(a.id) ?? null,
        }));

    const liquidEntityInPortfolio = effectiveTree
      ? new Map((effectiveTree.entities ?? []).map((e) => [e.id, e.includeInPortfolio]))
      : entityInPortfolio;

    const startingLiquidBalance = computeStartingLiquidBalance(
      liquidAccounts,
      liquidEntityInPortfolio,
      holdingsValueByAccountId,
    );

    // ── Seed management ──────────────────────────────────────────────────
    // Reads/persists the ACTIVE scenario's own seed (seedScenario), so each
    // scenario reproduces its own Monte Carlo draws. Account mixes, asset-class
    // volatility, and correlations stay base/firm-sourced (see the base-scenario
    // comment near the top). startingLiquidBalance and the in-estate liquid
    // account set follow effectiveTree when one is supplied.
    let seed = seedScenario.monteCarloSeed;
    if (seed == null) {
      seed = generateSeed();
      await db.update(scenarios).set({ monteCarloSeed: seed }).where(eq(scenarios.id, seedScenario.id));
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
