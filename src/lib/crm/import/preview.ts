import { buildRows, MAX_IMPORT_ROWS, type RowOverride, type ParsedRow } from "./rows";
import { findDuplicates, type RowDuplicates } from "./dedup";
import type { ColumnMapping } from "./columns";

export type PreviewResult = {
  rows: ParsedRow[];
  duplicates: RowDuplicates[];
  partialDedupCorpus: boolean;
  /** True when the file carried more than MAX_IMPORT_ROWS data rows. */
  truncated: boolean;
};

/**
 * The composition root both import endpoints call. A preview is a pure
 * function of (dataRows, mapping, overrides) plus the firm's dedup corpus —
 * nothing is stored between the upload and the commit.
 */
export async function buildPreview(
  dataRows: readonly (readonly (string | number)[])[],
  mapping: ColumnMapping,
  overrides: readonly RowOverride[] = [],
  opts: { existingHouseholds?: { id: string; name: string }[] } = {},
): Promise<PreviewResult> {
  const truncated = dataRows.length > MAX_IMPORT_ROWS;
  const capped = truncated ? dataRows.slice(0, MAX_IMPORT_ROWS) : dataRows;
  const rows = buildRows(capped, mapping, overrides);
  const { duplicates, partialDedupCorpus } = await findDuplicates(rows, opts);
  return { rows, duplicates, partialDedupCorpus, truncated };
}
