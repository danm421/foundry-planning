// src/lib/clients/create-diff-adapter.ts
//
// `computeRowDiff(null, row)` returns `{kind:"add"}` with NO `fields` — an add
// carries no from→to pairs, so a create preview can't reuse the edit-diff
// renderer. This adapter turns the would-be new row into the same flat
// `"field: value"` lines the approval card shows for an edit, so create + update
// previews read consistently. Pure + synchronous; null/undefined fields are
// dropped (an omitted optional shouldn't render as "field: —").
export function createDiffLines(rowFields: Record<string, unknown>): string[] {
  return Object.entries(rowFields)
    .filter(([, v]) => v != null)
    .map(([field, v]) => `${field}: ${String(v)}`);
}
