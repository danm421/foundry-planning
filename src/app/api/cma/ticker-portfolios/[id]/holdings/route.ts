import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { tickerPortfolios, tickerPortfolioHoldings, tickerPortfolioStats } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const holdingsBodySchema = z
  .object({
    holdings: z
      .array(
        z
          .object({
            displayTicker: z.string().min(1),
            securityId: z.string().uuid().nullable().optional(),
            weight: z.coerce.number().min(0).max(1),
          })
          .strict()
      )
      .default([]),
  })
  .strict();

// PUT /api/cma/ticker-portfolios/[id]/holdings — replace all holdings
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    // Verify portfolio belongs to this firm
    const [portfolio] = await db
      .select()
      .from(tickerPortfolios)
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)));

    if (!portfolio) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = holdingsBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid holdings payload" }, { status: 400 });
    }
    const { holdings } = parsed.data;

    // Guard against duplicate tickers (unique index on (tickerPortfolioId, displayTicker))
    const seen = new Set<string>();
    for (const h of holdings) {
      const t = h.displayTicker.toUpperCase();
      if (seen.has(t)) {
        return NextResponse.json({ error: `Duplicate ticker: ${t}` }, { status: 400 });
      }
      seen.add(t);
    }

    // Validate weights sum to ~1.0
    const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);
    if (holdings.length > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      return NextResponse.json(
        { error: `Weights must sum to 100% (got ${(totalWeight * 100).toFixed(1)}%)` },
        { status: 400 }
      );
    }

    // Delete existing holdings and insert new ones
    await db
      .delete(tickerPortfolioHoldings)
      .where(eq(tickerPortfolioHoldings.tickerPortfolioId, id));

    let inserted: (typeof tickerPortfolioHoldings.$inferSelect)[] = [];
    if (holdings.length > 0) {
      inserted = await db
        .insert(tickerPortfolioHoldings)
        .values(
          holdings.map((h, index) => ({
            tickerPortfolioId: id,
            displayTicker: h.displayTicker.toUpperCase(),
            securityId: h.securityId ?? null,
            weight: String(h.weight),
            sortOrder: index,
          }))
        )
        .returning();
    }

    // Invalidate cached stats so /stats recomputes on next request
    await db
      .delete(tickerPortfolioStats)
      .where(eq(tickerPortfolioStats.tickerPortfolioId, id));

    await recordAudit({
      action: "cma.ticker_portfolio.holdings.update",
      resourceType: "cma.ticker_portfolio",
      resourceId: id,
      firmId,
      metadata: { count: inserted.length },
    });

    return NextResponse.json(inserted);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/ticker-portfolios/[id]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
