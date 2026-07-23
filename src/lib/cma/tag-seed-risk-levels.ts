import { and, eq, isNull } from "drizzle-orm";

import { db as sharedDb } from "@/db";
import { modelPortfolios } from "@/db/schema";
import type { RiskLevel } from "@/lib/risk-levels";

type Executor = typeof sharedDb;

/** Exact seed name -> rung. Names carry the ratio suffix on purpose; a firm that
 *  renamed away is intentionally not matched. */
export const SEED_RISK_LEVELS: Record<string, RiskLevel> = {
  "Conservative (30/70)": "conservative",
  "Balanced (60/40)": "moderate",
  "Growth (80/20)": "moderately_aggressive",
  "Aggressive (100/0)": "aggressive",
};

/**
 * Tag a firm's seed portfolios by exact name, only where currently untagged and
 * only when that rung is free for the firm (guarding the partial unique index).
 * Idempotent. Returns the count newly tagged. Used both at seed time (new firms)
 * and by the backfill one-off (existing firms).
 */
export async function tagSeedPortfolioRiskLevels(
  executor: Executor,
  firmId: string,
): Promise<number> {
  let tagged = 0;
  for (const [name, level] of Object.entries(SEED_RISK_LEVELS)) {
    // Skip if this rung is already tagged on some OTHER portfolio for the firm.
    const [taken] = await executor
      .select({ id: modelPortfolios.id })
      .from(modelPortfolios)
      .where(and(eq(modelPortfolios.firmId, firmId), eq(modelPortfolios.riskLevel, level)))
      .limit(1);
    if (taken) continue;

    const updated = await executor
      .update(modelPortfolios)
      .set({ riskLevel: level, updatedAt: new Date() })
      .where(
        and(
          eq(modelPortfolios.firmId, firmId),
          eq(modelPortfolios.name, name),
          isNull(modelPortfolios.riskLevel),
        ),
      )
      .returning({ id: modelPortfolios.id });
    tagged += updated.length;
  }
  return tagged;
}
