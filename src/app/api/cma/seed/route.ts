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

    // Insert asset classes
    const insertedClasses = await db
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
      .returning();

    // Build name → id map for portfolio allocations
    const nameToId = new Map(insertedClasses.map((c) => [c.name, c.id]));

    // Insert model portfolios with allocations
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      const [portfolio] = await db
        .insert(modelPortfolios)
        .values({ firmId, name: mp.name, description: mp.description })
        .returning();

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
      { seeded: true, assetClasses: insertedClasses.length, portfolios: DEFAULT_MODEL_PORTFOLIOS.length },
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
