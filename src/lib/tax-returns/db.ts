import type { taxReturns } from "@/db/schema";
import {
  taxReturnFactsSchema,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";

export type TaxReturnRow = typeof taxReturns.$inferSelect;

export interface TaxReturnSummary {
  taxYear: number;
  status: TaxReturnRow["status"];
  warningCount: number;
  sourceFilename: string | null;
  updatedAt: string;
}

export function rowToSummary(row: TaxReturnRow): TaxReturnSummary {
  return {
    taxYear: row.taxYear,
    status: row.status,
    warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0,
    sourceFilename: row.sourceFilename,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function safeParse(value: unknown): TaxReturnFacts | null {
  if (value == null) return null;
  const parsed = taxReturnFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseRowFacts(row: TaxReturnRow): {
  facts: TaxReturnFacts | null;
  extractedFacts: TaxReturnFacts | null;
  parseError: boolean;
} {
  const facts = safeParse(row.facts);
  const extractedFacts = safeParse(row.extractedFacts);
  const parseError =
    (row.facts != null && facts === null) ||
    (row.extractedFacts != null && extractedFacts === null);
  return { facts, extractedFacts, parseError };
}
