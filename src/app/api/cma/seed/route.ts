import { NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses, modelPortfolios, modelPortfolioAllocations, assetClassCorrelations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS, DEFAULT_CORRELATIONS } from "@/lib/cma-seed";
import { canonicalPair } from "@/engine/monteCarlo/correlation-matrix";
import { authErrorResponse, requireOrgAdmin } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/cma/seed — seed default asset classes and model portfolios for this firm.
// Only runs if the firm has zero asset classes (first visit).
export async function POST() {
  try {
    await requireOrgAdmin();
    const firmId = await requireOrgId();

    // No early-return here: every downstream insert is idempotent (ON CONFLICT
    // DO NOTHING on asset classes and portfolios; per-portfolio allocation
    // guard; correlation block gated on "firm has zero correlations"). Running
    // this endpoint against an already-seeded firm is a near-no-op AND lets
    // us backfill correlations for firms that were seeded before the
    // asset_class_correlations table existed.

    // Insert asset classes — ON CONFLICT DO NOTHING protects against the React
    // strict-mode double-fire where two concurrent POSTs both see zero rows.
    await db
      .insert(assetClasses)
      .values(
        DEFAULT_ASSET_CLASSES.map((ac, i) => ({
          firmId,
          name: ac.name,
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
      .onConflictDoNothing({ target: [assetClasses.firmId, assetClasses.name] });

    // Re-fetch to get the canonical set (some rows may have been inserted by
    // a concurrent request).
    const allClasses = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    const nameToId = new Map(allClasses.map((c) => [c.name, c.id]));

    // Insert model portfolios with ON CONFLICT DO NOTHING
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      await db
        .insert(modelPortfolios)
        .values({ firmId, name: mp.name, description: mp.description })
        .onConflictDoNothing({ target: [modelPortfolios.firmId, modelPortfolios.name] });
    }

    // Fetch all portfolios for this firm and insert allocations only where none exist
    const allPortfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));

    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      const portfolio = allPortfolios.find((p) => p.name === mp.name);
      if (!portfolio) continue;

      // Only insert allocations if this portfolio has none yet
      const existingAllocs = await db
        .select({ id: modelPortfolioAllocations.id })
        .from(modelPortfolioAllocations)
        .where(eq(modelPortfolioAllocations.modelPortfolioId, portfolio.id))
        .limit(1);
      if (existingAllocs.length > 0) continue;

      const allocs = mp.allocations
        .filter((a) => nameToId.has(a.assetClassName))
        .map((a) => ({
          modelPortfolioId: portfolio.id,
          assetClassId: nameToId.get(a.assetClassName)!,
          weight: String(a.weight),
        }));

      if (allocs.length > 0) {
        await db.insert(modelPortfolioAllocations).values(allocs);
      }
    }

    // Seed pairwise correlations. Rows are written in canonical (a < b) order
    // so the unique index guarantees one row per pair. Skipped entirely if the
    // firm already has any correlations — an advisor may have customized them.
    const existingCorrelations = await db
      .select({ id: assetClassCorrelations.id })
      .from(assetClassCorrelations)
      .innerJoin(assetClasses, eq(assetClassCorrelations.assetClassIdA, assetClasses.id))
      .where(eq(assetClasses.firmId, firmId))
      .limit(1);

    let correlationsSeeded = 0;
    if (existingCorrelations.length === 0) {
      const correlationRows = DEFAULT_CORRELATIONS.flatMap((c) => {
        const idA = nameToId.get(c.classA);
        const idB = nameToId.get(c.classB);
        if (!idA || !idB || idA === idB) return [];
        const [a, b] = canonicalPair(idA, idB);
        return [{ assetClassIdA: a, assetClassIdB: b, correlation: String(c.correlation) }];
      });
      if (correlationRows.length > 0) {
        await db
          .insert(assetClassCorrelations)
          .values(correlationRows)
          .onConflictDoNothing({
            target: [assetClassCorrelations.assetClassIdA, assetClassCorrelations.assetClassIdB],
          });
        correlationsSeeded = correlationRows.length;
      }
    }

    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: {
        assetClasses: allClasses.length,
        portfolios: allPortfolios.length,
        correlations: correlationsSeeded,
      },
    });

    return NextResponse.json(
      {
        seeded: true,
        assetClasses: allClasses.length,
        portfolios: allPortfolios.length,
        correlations: correlationsSeeded,
      },
      { status: 201 }
    );
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/seed error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
