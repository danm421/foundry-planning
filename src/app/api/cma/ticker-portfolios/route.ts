import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tickerPortfolios, tickerPortfolioHoldings } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const portfolios = await db
      .select()
      .from(tickerPortfolios)
      .where(eq(tickerPortfolios.firmId, firmId))
      .orderBy(asc(tickerPortfolios.name));

    // Fetch holdings for all portfolios in one query
    const portfolioIds = portfolios.map((p) => p.id);
    let allHoldings: (typeof tickerPortfolioHoldings.$inferSelect)[] = [];
    if (portfolioIds.length > 0) {
      allHoldings = await db
        .select()
        .from(tickerPortfolioHoldings)
        .where(inArray(tickerPortfolioHoldings.tickerPortfolioId, portfolioIds));
    }

    // Group holdings by portfolio
    const holdingsByPortfolio = new Map<string, typeof allHoldings>();
    for (const holding of allHoldings) {
      const list = holdingsByPortfolio.get(holding.tickerPortfolioId) ?? [];
      list.push(holding);
      holdingsByPortfolio.set(holding.tickerPortfolioId, list);
    }

    return NextResponse.json(
      portfolios.map((p) => ({
        ...p,
        holdings: holdingsByPortfolio.get(p.id) ?? [],
      }))
    );
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/cma/ticker-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(tickerPortfolios)
      .values({ firmId, name, description: description ?? null })
      .returning();

    await recordAudit({
      action: "cma.ticker_portfolio.create",
      resourceType: "cma.ticker_portfolio",
      resourceId: created.id,
      firmId,
      metadata: { name: created.name },
    });

    return NextResponse.json({ ...created, holdings: [] }, { status: 201 });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/ticker-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
