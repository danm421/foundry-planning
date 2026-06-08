// src/lib/scenario/promote-coerce.ts
//
// Generic raw-payload → drizzle-insert coercion. A scenario change's add
// payload (and an edit's `to` values) are in raw form/DB shape, but Postgres
// `numeric` columns must receive strings. This walks the table's column
// metadata, stringifies numeric columns, and drops keys that aren't columns —
// so we need ONE coercer instead of a hand-written mapper per entity kind.
// Per-kind nested children (owners, schedules) are handled separately by the
// child-writer registry, not here.
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export function coerceForTable(
  table: PgTable,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const cols = getTableColumns(table);
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null || v === undefined) {
      out[key] = v ?? null;
      continue;
    }
    // Drizzle pg numeric columns expect string values.
    out[key] = (col as { columnType?: string }).columnType === "PgNumeric"
      ? String(v)
      : v;
  }
  return out;
}
