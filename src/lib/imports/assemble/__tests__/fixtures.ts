import { mergeAcrossFiles } from "../merge-across-files";
import type { ExtractedAccount, ExtractionResult } from "@/lib/extraction/types";

/**
 * A minimal per-file `ExtractionResult` for cross-file merge tests: every
 * section defaults to empty so a test only has to name the rows it cares
 * about. Shared by `merge-across-files.test.ts` and `decisions.test.ts` so
 * both exercise the SAME input shape — a second, subtly different builder
 * would let the two files disagree about what the merge is actually fed.
 */
export function er(
  fileName: string,
  extracted: Partial<ExtractionResult["extracted"]>,
  /**
   * The document's own stored text (`text` or `pages`) and warnings, for the
   * merge rules that read it. Optional and spread LAST: the default result
   * carries no text at all, which is the shape every test written before those
   * rules existed relies on — a merge cannot judge a number against text it
   * does not have, so those tests keep their numbers untouched.
   */
  doc?: Partial<Pick<ExtractionResult, "text" | "pages" | "warnings">>,
): ExtractionResult {
  return {
    documentType: "account_statement", fileName, promptVersion: "test", warnings: [],
    extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [], ...extracted },
    ...doc,
  };
}

/**
 * Merge an import of one-account documents, keyed by file name.
 *
 * Three test files had written this out identically, which is the very trap
 * `er`'s comment above warns about one level up: a second, subtly different
 * builder lets two test files disagree about what the merge is actually fed.
 * Callers that only care about the rows take `.payload.accounts`; callers that
 * assert on warnings or decisions keep the whole result.
 */
export function mergeOneRowPerFile(rows: Record<string, ExtractedAccount>) {
  return mergeAcrossFiles(
    Object.fromEntries(
      Object.entries(rows).map(([file, row]) => [file, er(file, { accounts: [row] })]),
    ),
  );
}
