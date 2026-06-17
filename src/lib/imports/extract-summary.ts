import type { ExtractionResult } from "@/lib/extraction/types";

/** Count the extracted rows across every category (family counts as one). */
export function countExtractedRows(r: ExtractionResult): number {
  const e = r.extracted;
  return (
    e.accounts.length +
    e.incomes.length +
    e.expenses.length +
    e.liabilities.length +
    e.entities.length +
    e.lifePolicies.length +
    e.wills.length +
    (e.family ? 1 : 0)
  );
}

/**
 * Decide the import status and surface warnings from a run's per-file results.
 * Any extracted row → "review"; otherwise "draft" so the UI shows the file's
 * warnings (e.g. scanned-image guidance) instead of an empty Review screen.
 */
export function summarizeExtraction(
  fileResults: Record<string, ExtractionResult>,
): { status: "review" | "draft"; warnings: string[]; totalRows: number } {
  const results = Object.values(fileResults);
  const totalRows = results.reduce((n, r) => n + countExtractedRows(r), 0);
  const warnings = Array.from(new Set(results.flatMap((r) => r.warnings)));
  return { status: totalRows > 0 ? "review" : "draft", warnings, totalRows };
}
