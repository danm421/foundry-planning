import { db } from "@/db";
import {
  accounts,
  modelPortfolios,
} from "@/db/schema";
import { inArray } from "drizzle-orm";
import type {
  EntitySnapshot,
  FieldLabels,
  ReferenceValue,
} from "../types";

export const ACCOUNT_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  category: { label: "Category", format: "text" },
  subType: { label: "Subtype", format: "text" },
  value: { label: "Account value", format: "currency" },
  basis: { label: "Cost basis", format: "currency" },
  growthRate: { label: "Growth rate", format: "percent" },
  rmdEnabled: { label: "RMD enabled", format: "text" },
  priorYearEndValue: { label: "Prior year-end balance", format: "currency" },
  isDefaultChecking: { label: "Default checking", format: "text" },
  growthSource: { label: "Growth source", format: "text" },
  modelPortfolio: { label: "Model portfolio", format: "reference" },
  turnoverPct: { label: "Turnover %", format: "percent" },
  annualPropertyTax: { label: "Annual property tax", format: "currency" },
  propertyTaxGrowthRate: { label: "Property tax growth", format: "percent" },
  source: { label: "Source", format: "text" },
};

type AccountRow = typeof accounts.$inferSelect;

export async function toAccountSnapshot(row: AccountRow): Promise<EntitySnapshot> {
  const modelPortfolio = await resolveModelPortfolio(row.modelPortfolioId);

  return {
    name: row.name,
    category: row.category,
    subType: row.subType,
    value: Number(row.value),
    basis: Number(row.basis),
    growthRate: row.growthRate === null ? null : Number(row.growthRate),
    rmdEnabled: row.rmdEnabled,
    priorYearEndValue: row.priorYearEndValue === null ? null : Number(row.priorYearEndValue),
    isDefaultChecking: row.isDefaultChecking,
    growthSource: row.growthSource,
    modelPortfolio,
    turnoverPct: Number(row.turnoverPct),
    annualPropertyTax: Number(row.annualPropertyTax),
    propertyTaxGrowthRate: Number(row.propertyTaxGrowthRate),
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
