/**
 * Bulk CRM import — public surface.
 *
 * The implementation lives in ./import/*. This barrel pulls in exceljs and db,
 * so it is SERVER-ONLY: client components import ./import/columns and
 * ./import/rows directly instead.
 */
export { readGrid } from "./import/read-file";
export {
  IMPORT_FIELDS,
  TEMPLATE_HEADERS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  detectMapping,
  sanitizeMapping,
  type ImportField,
  type ColumnMapping,
} from "./import/columns";
export { buildRows, MAX_IMPORT_ROWS, type ParsedRow, type RowOverride } from "./import/rows";
export { buildPreview } from "./import/preview";
export { commit, type ImportDecision } from "./import/commit";
