import "server-only";
import { db } from "@/db";
import {
  accounts,
  modelPortfolios,
  tickerPortfolios,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db-tx";
import type {
  EntitySnapshot,
  ReferenceValue,
} from "../types";

// Labels live in the server-free `../field-labels` so the client activity
// feed can import them without pulling in `@/db` (audit F3). Re-exported here
// so server callers keep importing `{ toAccountSnapshot, ACCOUNT_FIELD_LABELS }`.
export { ACCOUNT_FIELD_LABELS } from "../field-labels";

type AccountRow = typeof accounts.$inferSelect;

/** `handle`: a caller's transaction, so a name written earlier in it resolves. */
export async function toAccountSnapshot(row: AccountRow, handle?: DbOrTx): Promise<EntitySnapshot> {
  const modelPortfolio = await resolveModelPortfolio(row.modelPortfolioId, handle);
  const tickerPortfolio = await resolveTickerPortfolio(row.tickerPortfolioId, handle);

  return {
    name: row.name,
    category: row.category,
    subType: row.subType,
    value: Number(row.value),
    basis: Number(row.basis),
    rothValue: Number(row.rothValue ?? 0),
    growthRate: row.growthRate === null ? null : Number(row.growthRate),
    rmdEnabled: row.rmdEnabled,
    priorYearEndValue: row.priorYearEndValue === null ? null : Number(row.priorYearEndValue),
    inheritedDeathYear: row.inheritedDeathYear,
    inheritedOwnerBirthYear: row.inheritedOwnerBirthYear,
    inheritedHeirDisabled: row.inheritedHeirDisabled,
    inheritedPayoutFromYear: row.inheritedPayoutFromYear,
    inheritedPayoutThroughYear: row.inheritedPayoutThroughYear,
    isDefaultChecking: row.isDefaultChecking,
    growthSource: row.growthSource,
    modelPortfolio,
    tickerPortfolio,
    turnoverPct: Number(row.turnoverPct),
    marginBalance: Number(row.marginBalance),
    marginInterestRate: Number(row.marginInterestRate),
    marginCallPct: Number(row.marginCallPct),
    marginBorrowEnabled: row.marginBorrowEnabled === true,
    marginBorrowStartYear: row.marginBorrowStartYear ?? null,
    marginBorrowStartYearRef: row.marginBorrowStartYearRef ?? null,
    marginRepayYear: row.marginRepayYear ?? null,
    marginRepayYearRef: row.marginRepayYearRef ?? null,
    annualPropertyTax: Number(row.annualPropertyTax),
    propertyTaxGrowthRate: Number(row.propertyTaxGrowthRate),
    propertyTaxGrowthSource: row.propertyTaxGrowthSource,
    titlingType: row.titlingType,
    hsaCoverage: row.hsaCoverage,
    source: row.source,
  };
}

async function resolveModelPortfolio(
  id: string | null,
  handle?: DbOrTx,
): Promise<ReferenceValue | null> {
  if (!id) return null;
  const rows = await (handle ?? db)
    .select({ id: modelPortfolios.id, name: modelPortfolios.name })
    .from(modelPortfolios)
    .where(inArray(modelPortfolios.id, [id]));
  return { id, display: rows[0]?.name ?? "(deleted)" };
}

async function resolveTickerPortfolio(
  id: string | null,
  handle?: DbOrTx,
): Promise<ReferenceValue | null> {
  if (!id) return null;
  const rows = await (handle ?? db)
    .select({ id: tickerPortfolios.id, name: tickerPortfolios.name })
    .from(tickerPortfolios)
    .where(inArray(tickerPortfolios.id, [id]));
  return { id, display: rows[0]?.name ?? "(deleted)" };
}
