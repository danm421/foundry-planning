// src/lib/cma/resolve-risk-portfolio.ts
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { modelPortfolios, planSettings } from "@/db/schema";
import type { RiskLevel } from "@/lib/risk-levels";
import type { Tx } from "@/lib/imports/commit/types";

/**
 * The firm's model portfolio tagged with this risk rung, or null when the firm
 * has tagged none. The (firm_id, risk_level) partial unique index guarantees at
 * most one row, so this is an unambiguous single lookup.
 */
export async function resolveRiskPortfolioId(
  firmId: string,
  tolerance: RiskLevel,
): Promise<string | null> {
  const [row] = await db
    .select({ id: modelPortfolios.id })
    .from(modelPortfolios)
    .where(
      and(
        eq(modelPortfolios.firmId, firmId),
        eq(modelPortfolios.riskLevel, tolerance),
        isNotNull(modelPortfolios.riskLevel),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Point a scenario's taxable + retirement growth at a model portfolio. The cash
 * bucket is deliberately left as-is (a "moderate" investor still holds cash as
 * cash). The engine already consumes these columns — no engine change.
 */
export async function applyRiskPortfolioToScenario(
  tx: Tx,
  scenarioId: string,
  portfolioId: string,
): Promise<void> {
  await tx
    .update(planSettings)
    .set({
      modelPortfolioIdTaxable: portfolioId,
      growthSourceTaxable: "model_portfolio",
      modelPortfolioIdRetirement: portfolioId,
      growthSourceRetirement: "model_portfolio",
      updatedAt: new Date(),
    })
    .where(eq(planSettings.scenarioId, scenarioId));
}
