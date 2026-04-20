import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await getOrgId();
    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
      .orderBy(asc(modelPortfolios.name));

    // Fetch allocations for all portfolios in one query
    const portfolioIds = portfolios.map((p) => p.id);
    let allAllocations: (typeof modelPortfolioAllocations.$inferSelect)[] = [];
    if (portfolioIds.length > 0) {
      allAllocations = await db
        .select()
        .from(modelPortfolioAllocations)
        .where(inArray(modelPortfolioAllocations.modelPortfolioId, portfolioIds));
    }

    // Group allocations by portfolio
    const allocsByPortfolio = new Map<string, typeof allAllocations>();
    for (const alloc of allAllocations) {
      const list = allocsByPortfolio.get(alloc.modelPortfolioId) ?? [];
      list.push(alloc);
      allocsByPortfolio.set(alloc.modelPortfolioId, list);
    }

    return NextResponse.json(
      portfolios.map((p) => ({
        ...p,
        allocations: allocsByPortfolio.get(p.id) ?? [],
      }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/model-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const firmId = await getOrgId();
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(modelPortfolios)
      .values({ firmId, name, description: description ?? null })
      .returning();

    return NextResponse.json({ ...created, allocations: [] }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/model-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
