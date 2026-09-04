import { NextResponse } from "next/server";
import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { tickerPortfolios, modelPortfolios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscriptionForFirm, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { deriveAllocationsForFund } from "@/lib/investments/sync-derived-model-portfolio";
import {
  liveSyncDeps,
  writeDerivedAllocations,
} from "@/lib/investments/derived-model-portfolio-deps";
import { MAX_UNCLASSIFIED } from "@/lib/investments/derive-model-allocations";
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
    await requireActiveSubscriptionForFirm(firmId);
    const { id } = await params;

    const [fund] = await db
      .select()
      .from(tickerPortfolios)
      .where(and(eq(tickerPortfolios.id, id), eq(tickerPortfolios.firmId, firmId)));
    if (!fund) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Derive BEFORE creating anything: a gate failure must not leave a
    // 0%-allocated portfolio behind, and a crash between an insert and its
    // allocations would leave one that re-promoting then finds and never cleans
    // up. Deriving first means there is nothing to roll back.
    const outcome = await deriveAllocationsForFund({ tickerPortfolioId: id, firmId }, liveSyncDeps());

    if (!outcome.ok) {
      const detail =
        outcome.reason === "empty"
          ? "This fund portfolio has no holdings."
          : `${(outcome.unclassifiedWeight * 100).toFixed(1)}% of this portfolio could not be classified` +
            (outcome.droppedSlugs.length
              ? ` (no asset class for: ${outcome.droppedSlugs.join(", ")})`
              : "") +
            `. Promotion needs at least ${((1 - MAX_UNCLASSIFIED) * 100).toFixed(0)}% classified.`;
      return NextResponse.json({ error: detail }, { status: 422 });
    }

    const existing = await db
      .select({
        id: modelPortfolios.id,
        name: modelPortfolios.name,
        sourceTickerPortfolioId: modelPortfolios.sourceTickerPortfolioId,
      })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));

    let derivedId = existing.find((p) => p.sourceTickerPortfolioId === id)?.id ?? null;
    if (!derivedId) {
      const [created] = await db
        .insert(modelPortfolios)
        .values({
          firmId,
          // A fund's name is unique only among funds; model portfolio names are
          // unique per firm. Without this, promoting "Balanced" into a firm that
          // already has one throws a raw constraint violation at the advisor.
          name: freeModelPortfolioName(
            fund.name,
            existing.map((p) => p.name),
          ),
          description: `Derived from the fund portfolio "${fund.name}".`,
          sourceTickerPortfolioId: id,
        })
        .returning({ id: modelPortfolios.id });
      derivedId = created.id;
    }

    await writeDerivedAllocations(derivedId, outcome.allocations);

    await recordAudit({
      action: "cma.ticker_portfolio.promote",
      resourceType: "cma.model_portfolio",
      resourceId: derivedId,
      firmId,
      metadata: { tickerPortfolioId: id, allocations: outcome.allocations.length },
    });

    return NextResponse.json({
      modelPortfolioId: derivedId,
      allocations: outcome.allocations.length,
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/ticker-portfolios/[id]/promote error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
