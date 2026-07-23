import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  planSettings,
  clientCmaOverrides,
} from "@/db/schema";
import { resolveInflationRate } from "@/lib/inflation";
import { loadFundPortfolioOptions, type FundPortfolioOption } from "@/lib/investments/load-fund-portfolio-options";
import { type RiskLevel } from "@/lib/risk-levels";

export interface GrowthContextPortfolio {
  id: string;
  name: string;
  blendedReturn: number; // decimal
  riskLevel: RiskLevel | null;
}

export interface GrowthContext {
  modelPortfolios: GrowthContextPortfolio[];
  fundPortfolios: FundPortfolioOption[];
  resolvedInflationRate: number; // decimal
  /** Keyed by account category (taxable/cash/retirement). */
  categoryDefaults: Record<string, { portfolioName: string | null; blendedReturnPct: number | null }>;
}

/**
 * Load the growth-rate dropdown context for the import review's accounts step —
 * model portfolios with blended returns, the resolved plan inflation rate, and
 * the per-category default portfolios. Mirrors the inline computation in
 * net-worth-content.tsx so the import review offers identical options to the
 * regular account editor.
 */
export async function loadImportGrowthContext(
  clientId: string,
  firmId: string,
  scenarioId: string | null,
): Promise<GrowthContext> {
  const [portfolioRows, allocationRows, assetClassRows, settingsRows, fundPortfolios] = await Promise.all([
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    scenarioId
      ? db
          .select()
          .from(planSettings)
          .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)))
      : Promise.resolve([]),
    loadFundPortfolioOptions(firmId),
  ]);

  const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
  const blendedById = new Map<string, number>();
  const portfolios: GrowthContextPortfolio[] = portfolioRows.map((p) => {
    let blended = 0;
    for (const alloc of allocationRows) {
      if (alloc.modelPortfolioId !== p.id) continue;
      const ac = acMap.get(alloc.assetClassId);
      if (ac) blended += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
    }
    blendedById.set(p.id, blended);
    return { id: p.id, name: p.name, blendedReturn: blended, riskLevel: p.riskLevel };
  });

  const settings = settingsRows[0];

  // Inflation (mirrors net-worth-content): firm inflation asset class +
  // optional client override when useCustomCma is set.
  const firmInflationAc = assetClassRows.find((ac) => ac.slug === "inflation") ?? null;
  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings?.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(eq(clientCmaOverrides.clientId, clientId), eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id)));
    if (override) clientInflationOverride = override;
  }
  const resolvedInflationRate = resolveInflationRate(
    { inflationRateSource: settings?.inflationRateSource ?? "custom", inflationRate: settings?.inflationRate ?? "0" },
    firmInflationAc ? { geometricReturn: firmInflationAc.geometricReturn } : null,
    clientInflationOverride,
  );

  // Per-category default portfolio (plan_settings.modelPortfolioId{Taxable,Cash,Retirement}).
  const nameById = new Map(portfolioRows.map((p) => [p.id, p.name]));
  const buildDefault = (mpId: string | null | undefined) => {
    if (!mpId) return { portfolioName: null, blendedReturnPct: null };
    const blended = blendedById.get(mpId);
    return {
      portfolioName: nameById.get(mpId) ?? null,
      blendedReturnPct: blended != null ? Math.round(blended * 10000) / 100 : null,
    };
  };
  const categoryDefaults: GrowthContext["categoryDefaults"] = {
    taxable: buildDefault(settings?.modelPortfolioIdTaxable),
    cash: buildDefault(settings?.modelPortfolioIdCash),
    retirement: buildDefault(settings?.modelPortfolioIdRetirement),
  };

  return { modelPortfolios: portfolios, fundPortfolios, resolvedInflationRate, categoryDefaults };
}
