import type { ExtractionResult } from "@/lib/extraction/types";

/**
 * A minimal per-file `ExtractionResult` for cross-file merge tests: every
 * section defaults to empty so a test only has to name the rows it cares
 * about. Shared by `merge-across-files.test.ts` and `decisions.test.ts` so
 * both exercise the SAME input shape — a second, subtly different builder
 * would let the two files disagree about what the merge is actually fed.
 */
export function er(fileName: string, extracted: Partial<ExtractionResult["extracted"]>): ExtractionResult {
  return {
    documentType: "account_statement", fileName, promptVersion: "test", warnings: [],
    extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [], ...extracted },
  };
}
