import { NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses, modelPortfolios, modelPortfolioAllocations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS } from "@/lib/cma-seed";

// POST /api/cma/seed — seed default asset classes and model portfolios for this firm.
// Only runs if the firm has zero asset classes (first visit).
export async function POST() {
  try {
    const firmId = await getOrgId();

    // Check if firm already has asset classes
    const existing = await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ seeded: false, message: "Asset classes already exist" });
    }

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

    return NextResponse.json(
      { seeded: true, assetClasses: allClasses.length, portfolios: allPortfolios.length },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/seed error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
