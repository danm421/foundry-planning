import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tickerPortfolios, assetClasses } from "@/db/schema";
import { loadTickerPortfolioAllocations } from "./load-ticker-portfolio-allocations";
import { tickerPortfolioBlendedReturnPct } from "./ticker-portfolio-allocation";

export interface FundPortfolioOption {
  id: string;
  name: string;
  blendedReturnPct: number | null;
}

/** Firm's fund portfolios as growth-source dropdown options, each with a
 *  CMA-blended return % (0–100) or null when no holdings classify. */
export async function loadFundPortfolioOptions(firmId: string): Promise<FundPortfolioOption[]> {
  const [portfolios, acRows] = await Promise.all([
    db
      .select({ id: tickerPortfolios.id, name: tickerPortfolios.name })
      .from(tickerPortfolios)
      .where(eq(tickerPortfolios.firmId, firmId)),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
  ]);
  if (portfolios.length === 0) return [];

  const slugToAssetClassId = new Map<string, string>();
  const assetClassReturns: Record<string, number> = {};
  for (const ac of acRows) {
    if (ac.slug) slugToAssetClassId.set(ac.slug, ac.id);
    assetClassReturns[ac.id] = parseFloat(ac.geometricReturn);
  }

  const allocRows = await loadTickerPortfolioAllocations(firmId, slugToAssetClassId);
  const rowsByPortfolio = new Map<string, { assetClassId: string; weight: number }[]>();
  for (const r of allocRows) {
    const list = rowsByPortfolio.get(r.tickerPortfolioId) ?? [];
    list.push({ assetClassId: r.assetClassId, weight: parseFloat(r.weight) });
    rowsByPortfolio.set(r.tickerPortfolioId, list);
  }

  return portfolios.map((p) => ({
    id: p.id,
    name: p.name,
    blendedReturnPct: tickerPortfolioBlendedReturnPct(rowsByPortfolio.get(p.id) ?? [], assetClassReturns),
  }));
}
