import "server-only";
import { db } from "@/db";
import {
  accounts,
  modelPortfolios,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import type {
  EntitySnapshot,
  ReferenceValue,
} from "../types";

// Labels live in the server-free `../field-labels` so the client activity
// feed can import them without pulling in `@/db` (audit F3). Re-exported here
// so server callers keep importing `{ toAccountSnapshot, ACCOUNT_FIELD_LABELS }`.
export { ACCOUNT_FIELD_LABELS } from "../field-labels";

type AccountRow = typeof accounts.$inferSelect;

export async function toAccountSnapshot(row: AccountRow): Promise<EntitySnapshot> {
  const modelPortfolio = await resolveModelPortfolio(row.modelPortfolioId);

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
    isDefaultChecking: row.isDefaultChecking,
    growthSource: row.growthSource,
    modelPortfolio,
    turnoverPct: Number(row.turnoverPct),
    annualPropertyTax: Number(row.annualPropertyTax),
    propertyTaxGrowthRate: Number(row.propertyTaxGrowthRate),
    propertyTaxGrowthSource: row.propertyTaxGrowthSource,
    titlingType: row.titlingType,
    source: row.source,
  };
}

async function resolveModelPortfolio(
  id: string | null,
): Promise<ReferenceValue | null> {
  if (!id) return null;
  const rows = await db
    .select({ id: modelPortfolios.id, name: modelPortfolios.name })
    .from(modelPortfolios)
    .where(inArray(modelPortfolios.id, [id]));
  return { id, display: rows[0]?.name ?? "(deleted)" };
}
