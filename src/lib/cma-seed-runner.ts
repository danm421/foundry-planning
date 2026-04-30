import { db } from "@/db";
import {
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_ASSET_CLASSES,
  DEFAULT_MODEL_PORTFOLIOS,
  DEFAULT_CORRELATIONS,
} from "@/lib/cma-seed";
import { canonicalPair } from "@/engine/monteCarlo/correlation-matrix";

export type SeedResult = {
  assetClasses: number; // total rows for firm after seed
  portfolios: number;
  correlations: number;
  inserted: {
    assetClasses: number; // rows this call actually added
    portfolios: number;
    allocations: number;
    correlations: number;
  };
};

/**
 * Seed default CMAs (asset classes, model portfolios + allocations,
 * pairwise correlations) for a firm. Idempotent — safe to call more
 * than once. Trusts the caller to have authorized the action; does
 * no auth checks itself.
 *
 * Called from three places:
 *   - POST /api/cma/seed (admin/owner manual retrigger, auth via requireOrgAdminOrOwner)
 *   - POST /api/webhooks/clerk (organization.created event, auth via Svix signature)
 *   - /cma client on mount (advisor's lazy fallback)
 *
 * Returns both post-seed totals and per-call inserted counts. Callers
 * use `inserted` to distinguish "already seeded, did nothing" from
 * "actually added rows" (e.g. the Layer 3 warning log).
 */
export async function seedCmaForFirm(firmId: string): Promise<SeedResult> {
  // Count asset classes before, so we can report how many this call inserted.
  const classesBefore = (
    await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
  ).length;

  // Asset classes — ON CONFLICT DO NOTHING protects against concurrent callers
  // (e.g. React strict-mode double-mount firing two lazy seeds in parallel).
  await db
    .insert(assetClasses)
    .values(
      DEFAULT_ASSET_CLASSES.map((ac, i) => ({
        firmId,
        name: ac.name,
        slug: ac.slug,
        geometricReturn: String(ac.geometricReturn),
        arithmeticMean: String(ac.arithmeticMean),
        volatility: String(ac.volatility),
        pctOrdinaryIncome: String(ac.pctOrdinaryIncome),
        pctLtCapitalGains: String(ac.pctLtCapitalGains),
        pctQualifiedDividends: String(ac.pctQualifiedDividends),
        pctTaxExempt: String(ac.pctTaxExempt),
        sortOrder: i,
        assetType: ac.assetType,
      }))
    )
    .onConflictDoNothing({
      target: [assetClasses.firmId, assetClasses.name],
    });

  const allClasses = await db
    .select()
    .from(assetClasses)
    .where(eq(assetClasses.firmId, firmId));
  const nameToId = new Map(allClasses.map((c) => [c.name, c.id]));
  const insertedClasses = allClasses.length - classesBefore;

  const portfoliosBefore = (
    await db
      .select({ id: modelPortfolios.id })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
  ).length;

  // Portfolios — one insert per portfolio so each has its own ON CONFLICT guard.
  for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
    await db
      .insert(modelPortfolios)
      .values({ firmId, name: mp.name, description: mp.description })
      .onConflictDoNothing({
        target: [modelPortfolios.firmId, modelPortfolios.name],
      });
  }

  const allPortfolios = await db
    .select()
    .from(modelPortfolios)
    .where(eq(modelPortfolios.firmId, firmId));
  const insertedPortfolios = allPortfolios.length - portfoliosBefore;

  // Allocations — only insert for portfolios that currently have none.
  // Prevents duplicates when an earlier seed partially completed.
  let insertedAllocations = 0;
  for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
    const portfolio = allPortfolios.find((p) => p.name === mp.name);
    if (!portfolio) continue;

    const existing = await db
      .select({ id: modelPortfolioAllocations.id })
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, portfolio.id))
      .limit(1);
    if (existing.length > 0) continue;

    const allocs = mp.allocations
      .filter((a) => nameToId.has(a.assetClassName))
      .map((a) => ({
        modelPortfolioId: portfolio.id,
        assetClassId: nameToId.get(a.assetClassName)!,
        weight: String(a.weight),
      }));
    if (allocs.length > 0) {
      await db.insert(modelPortfolioAllocations).values(allocs);
      insertedAllocations += allocs.length;
    }
  }

  // Correlations — skip entirely if the firm already has any, so we never
  // trample advisor-customized matrices.
  const existingCorrelations = await db
    .select({ id: assetClassCorrelations.id })
    .from(assetClassCorrelations)
    .innerJoin(
      assetClasses,
      eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
    )
    .where(eq(assetClasses.firmId, firmId))
    .limit(1);

  let insertedCorrelations = 0;
  if (existingCorrelations.length === 0) {
    const correlationRows = DEFAULT_CORRELATIONS.flatMap((c) => {
      const idA = nameToId.get(c.classA);
      const idB = nameToId.get(c.classB);
      if (!idA || !idB || idA === idB) return [];
      const [a, b] = canonicalPair(idA, idB);
      return [
        {
          assetClassIdA: a,
          assetClassIdB: b,
          correlation: String(c.correlation),
        },
      ];
    });
    if (correlationRows.length > 0) {
      await db
        .insert(assetClassCorrelations)
        .values(correlationRows)
        .onConflictDoNothing({
          target: [
            assetClassCorrelations.assetClassIdA,
            assetClassCorrelations.assetClassIdB,
          ],
        });
      insertedCorrelations = correlationRows.length;
    }
  }

  const totalCorrelations = (
    await db
      .select({ id: assetClassCorrelations.id })
      .from(assetClassCorrelations)
      .innerJoin(
        assetClasses,
        eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
      )
      .where(eq(assetClasses.firmId, firmId))
  ).length;

  return {
    assetClasses: allClasses.length,
    portfolios: allPortfolios.length,
    correlations: totalCorrelations,
    inserted: {
      assetClasses: insertedClasses,
      portfolios: insertedPortfolios,
      allocations: insertedAllocations,
      correlations: insertedCorrelations,
    },
  };
}
