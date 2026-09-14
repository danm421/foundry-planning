import { createElement, Fragment, type ReactNode } from "react";
import type { DetailEntity, DetailField } from "@/domain/forge/detail-fields";
import { formatValue, type ColumnKind, type ColumnSpec } from "./entity-table";

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
 * Fields the create path will actually accept, required first so an
 * incomplete row reads at a glance. Shared by the capped columns and the
 * overflow disclosure below so the two can never disagree about which
 * fields are askable, or their order.
 */
function askableOrdered(entity: DetailEntity): readonly DetailField[] {
  const askable = entity.fields.filter((f) => f.appliesTo !== "update" && f.writable !== false);
  return [...askable.filter((f) => f.required), ...askable.filter((f) => !f.required)];
}

/**
 * Honest compact summary for an "object"/"array" field — never
 * `formatValue`'s `String(value)` fallback, which is `[object Object]` for a
 * plain object (Task 12 review, Ruling 18).
 *
 * Generic on purpose: this knows nothing about any one entity's shape. The
 * map's common structured shape is a discriminated union (e.g. the life
 * policy's `ownerRef`), whose `kind` field IS its own readable summary —
 * anything else about the value is meaningless without knowing which variant
 * it is. A plain object with no such discriminant falls back to a field
 * count; an array falls back to an item count — both honest that a value is
 * PRESENT without pretending to show it in full.
 */
function summarizeStructured(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.kind === "string") return obj.kind;
  const keys = Object.keys(obj);
  return keys.length > 0 ? `${keys.length} field${keys.length === 1 ? "" : "s"}` : "—";
}

/**
 * Kind-aware cell text, shared by the capped columns' `render` below and the
 * overflow disclosure — an object/array field has to read the same honest
 * summary wherever it lands, not "[object Object]" in one place and a real
 * summary in the other.
 */
function cellText(kind: DetailField["kind"], value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return kind === "object" || kind === "array"
    ? summarizeStructured(value)
    : formatValue(toColumnKind(kind), value);
}

/**
 * Build the review table's columns for one entity, straight from the map.
 *
 * Fields the create path refuses are never offered — showing an advisor a
 * cell whose value the server will drop is worse than not showing it.
 *
 * `align` is deliberately NOT set here (Task 12 ruling 14): `entity-table.tsx`
 * already right-aligns money/number/percent/rate/year (and price) by kind, so
 * a second hardcoded list here would only ever be a copy that could drift the
 * moment a kind is added to one and not the other.
 */
export function columnsForEntity(entity: DetailEntity): ColumnSpec<CandidateRowView>[] {
  return askableOrdered(entity)
    .slice(0, MAX_COLUMNS)
    .map((field) => ({
      key: field.key,
      header: field.label,
      kind: toColumnKind(field.kind),
      render: (row: CandidateRowView) => cellText(field.kind, row[field.key]),
    }));
}

/**
 * The askable fields past `MAX_COLUMNS` — reachable through
 * `entity-table.tsx`'s existing `expand` disclosure instead of a wall of
 * columns (Task 12 review, Important 2).
 */
export function overflowFields(entity: DetailEntity): readonly DetailField[] {
  return askableOrdered(entity).slice(MAX_COLUMNS);
}

/**
 * Compact label/value disclosure for `fields` (the overflow past the column
 * cap). Returns `null` when there is nothing to disclose — `entity-table.tsx`
 * renders no expand button at all for a row whose `expand` callback returns
 * a falsy value, so an entity with 8 or fewer askable fields gets none.
 */
export function renderOverflow(fields: readonly DetailField[], row: CandidateRowView): ReactNode {
  if (fields.length === 0) return null;
  return createElement(
    "dl",
    { className: "grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs" },
    fields.map((field) =>
      createElement(
        Fragment,
        { key: field.key },
        createElement("dt", { className: "text-ink-3" }, field.label),
        createElement("dd", { className: "text-ink" }, cellText(field.kind, row[field.key])),
      ),
    ),
  );
}
