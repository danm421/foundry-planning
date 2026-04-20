import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import {
  clients,
  scenarios,
  accounts,
  planSettings,
  entities,
  modelPortfolioAllocations,
  assetClasses,
  accountAssetAllocations,
  assetClassCorrelations,
} from "@foundry/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { buildCorrelationMatrix } from "@/engine/monteCarlo/correlation-matrix";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { IndexInput } from "@/engine/monteCarlo/returns";

export const dynamic = "force-dynamic";

// Fresh seed in the signed-int32 range — well within PostgreSQL's `integer` column.
function generateSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * GET /api/clients/[id]/monte-carlo-data — returns the Monte Carlo payload for
 * the client's base-case scenario. Companion to /projection-data; the page
 * fetches both in parallel and feeds them to runMonteCarlo.
 *
 * Response shape:
 *   {
 *     indices: IndexInput[],              // asset classes participating in the run
 *     correlation: number[][],            // symmetric, ordered same as `indices`
 *     accountMixes: Array<{ accountId, mix }>,
 *     startingLiquidBalance: number,      // CAGR reference, sum of investable account values
 *     seed: number,                       // persisted per scenario
 *     requiredMinimumAssetLevel: number,  // v1: hardcoded to 0 (per-plan setting deferred)
 *   }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    if (!scenario) return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });

    const [
      accountRows,
      settingsRow,
      entityRows,
      assetClassRows,
      accountAllocationRows,
      portfolioAllocationRows,
      correlationRows,
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
    ]);
    const settings = settingsRow[0];
    if (!settings) return NextResponse.json({ error: "No plan settings" }, { status: 404 });

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
    const accountInEstate = (a: typeof accountRows[number]): boolean =>
      a.ownerEntityId == null || entityInPortfolio.get(a.ownerEntityId) === true;

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

    return NextResponse.json({
      indices,
      correlation,
      accountMixes,
      startingLiquidBalance,
      seed,
      // v1: hardcoded; per-plan setting deferred to FUTURE_WORK.md.
      requiredMinimumAssetLevel: 0,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/monte-carlo-data error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/clients/[id]/monte-carlo-data/reseed — overwrite the persisted
 * seed with a fresh one. Triggered by the report's "Restart" button
 * (PDF p.13 "Result Repeatability").
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    if (!scenario) return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });

    const seed = generateSeed();
    await db.update(scenarios).set({ monteCarloSeed: seed }).where(eq(scenarios.id, scenario.id));
    return NextResponse.json({ seed });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/monte-carlo-data error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
