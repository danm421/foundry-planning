import { NextResponse } from "next/server";
import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { tickerPortfolios, modelPortfolios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { syncDerivedAllocations } from "@/lib/investments/sync-derived-model-portfolio";
import { liveSyncDeps } from "@/lib/investments/derived-model-portfolio-deps";
import { freeModelPortfolioName } from "@/lib/investments/derived-portfolio-name";

export const dynamic = "force-dynamic";

/**
 * POST /api/cma/ticker-portfolios/[id]/promote
 *
 * Create (or re-sync) the model portfolio derived from this fund portfolio.
 * Promotion is the only way a fund portfolio reaches a plan: every downstream
 * surface — growth source, Monte Carlo, benchmark, reinvestment target — speaks
 * model portfolio and nothing else.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    const [fund] = await db
      .select()
      .from(tickerPortfolios)
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)));
    if (!fund) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const existing = await db
      .select({
        id: modelPortfolios.id,
        name: modelPortfolios.name,
        sourceTickerPortfolioId: modelPortfolios.sourceTickerPortfolioId,
      })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));

    let derived = existing.find((p) => p.sourceTickerPortfolioId === id) ?? null;
    // Only a portfolio THIS request created may be rolled back on failure.
    const isNew = derived === null;

    if (!derived) {
      const name = freeModelPortfolioName(
        fund.name,
        existing.map((p) => p.name),
      );
      const [created] = await db
        .insert(modelPortfolios)
        .values({
          firmId,
          name,
          description: `Derived from the fund portfolio "${fund.name}".`,
          sourceTickerPortfolioId: id,
        })
        .returning({
          id: modelPortfolios.id,
          name: modelPortfolios.name,
          sourceTickerPortfolioId: modelPortfolios.sourceTickerPortfolioId,
        });
      derived = created;
    }

    const outcome = await syncDerivedAllocations(
      { tickerPortfolioId: id, modelPortfolioId: derived.id, firmId },
      liveSyncDeps(),
    );

    if (!outcome.ok) {
      // Nothing was written. Roll the empty shell back so a failed promotion
      // doesn't leave a 0%-allocated portfolio in the advisor's list — but only
      // when this request created it. Re-promoting an established portfolio that
      // has since gone unclassifiable must report the problem, not delete a
      // portfolio the plans already point at.
      if (isNew) {
        await db.delete(modelPortfolios).where(eq(modelPortfolios.id, derived.id));
      }
      const detail =
        outcome.reason === "empty"
          ? "This fund portfolio has no holdings."
          : `${(outcome.unclassifiedWeight * 100).toFixed(1)}% of this portfolio could not be classified` +
            (outcome.droppedSlugs.length
              ? ` (no asset class for: ${outcome.droppedSlugs.join(", ")})`
              : "") +
            ". Promotion needs at least 95% classified.";
      return NextResponse.json({ error: detail }, { status: 422 });
    }

    await recordAudit({
      action: "cma.ticker_portfolio.promote",
      resourceType: "cma.model_portfolio",
      resourceId: derived.id,
      firmId,
      metadata: { tickerPortfolioId: id, allocations: outcome.written },
    });

    return NextResponse.json({
      modelPortfolioId: derived.id,
      name: derived.name,
      allocations: outcome.written,
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/ticker-portfolios/[id]/promote error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
