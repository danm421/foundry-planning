import type { DetailEntity, DetailField } from "@/domain/forge/detail-fields";
import type { ColumnKind, ColumnSpec } from "./entity-table";

export type CandidateRowView = Record<string, unknown> & { __rowId: string };

/** A 22-field entity would render an unreadable wall. The rest expand per row. */
export const MAX_COLUMNS = 8;

/**
 * The table formats `text` the same as `string`, and has no notion of a uuid or
 * a structured value — those render as plain strings.
 */
function toColumnKind(kind: DetailField["kind"]): ColumnKind {
  switch (kind) {
    case "text":
    case "uuid":
    case "object":
    case "array":
      return "string";
    default:
      return kind;
  }
}

/**
 * Build the review table's columns for one entity, straight from the map.
 *
 * Required fields lead, so a row missing something reads at a glance. Fields
 * the create path refuses are never offered — showing an advisor a cell whose
 * value the server will drop is worse than not showing it.
 *
 * `align` is deliberately NOT set here (Task 12 ruling 14): `entity-table.tsx`
 * already right-aligns money/number/percent/rate/year (and price) by kind, so
 * a second hardcoded list here would only ever be a copy that could drift the
 * moment a kind is added to one and not the other.
 */
export function columnsForEntity(entity: DetailEntity): ColumnSpec<CandidateRowView>[] {
  const askable = entity.fields.filter((f) => f.appliesTo !== "update" && f.writable !== false);
  const ordered = [
    ...askable.filter((f) => f.required),
    ...askable.filter((f) => !f.required),
  ];
  return ordered.slice(0, MAX_COLUMNS).map((field) => ({
    key: field.key,
    header: field.label,
    kind: toColumnKind(field.kind),
  }));
}
