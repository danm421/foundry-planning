import { sql, type SQL } from "drizzle-orm";
import { crmHouseholds } from "@/db/schema";

export type ClientSortKey = "name" | "status" | "primary" | "spouse" | "updated";
export type SortDir = "asc" | "desc";
export type ClientsView = "recent" | "all" | "deleted";

export const PAGE_SIZE = 50;
export const MAX_TAKE = 1000;

/**
 * Default direction per key. Text sorts read A→Z; a date reads newest-first.
 */
export const DEFAULT_DIR: Record<ClientSortKey, SortDir> = {
  name: "asc",
  status: "asc",
  primary: "asc",
  spouse: "asc",
  updated: "desc",
};

/**
 * The view's ordering when no ?sort= is supplied. `null` means "leave the
 * loader's existing ORDER BY alone" — Recently-opened is ordered by when the
 * user opened each household (the reason that view exists) and Trash by
 * deletion time, so neither gets an alphabetical default.
 */
const VIEW_DEFAULT: Record<ClientsView, ClientSortKey | null> = {
  all: "name",
  recent: null,
  deleted: null,
};

function isSortKey(v: string | undefined): v is ClientSortKey {
  return v === "name" || v === "status" || v === "primary" || v === "spouse" || v === "updated";
}

/**
 * Resolves ?sort= / ?dir= against a frozen whitelist. Anything unrecognized
 * falls back to the view default — URL text never reaches SQL, because the key
 * only ever selects a prebuilt expression in `buildOrderBy`.
 */
export function resolveSort(
  view: ClientsView,
  rawSort: string | undefined,
  rawDir: string | undefined,
): { key: ClientSortKey | null; dir: SortDir } {
  const key = isSortKey(rawSort) ? rawSort : VIEW_DEFAULT[view];
  if (key == null) return { key: null, dir: "asc" };
  const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : DEFAULT_DIR[key];
  return { key, dir };
}

/**
 * Whether to offer another page. `take` is clamped to MAX_TAKE, so at the
 * ceiling raising it is a no-op — the control would render forever and do
 * nothing. Hide it instead of lying.
 */
export function shouldShowLoadMore(hasMore: boolean, take: number): boolean {
  return hasMore && take < MAX_TAKE;
}

/** Parses ?take=, clamped so a hostile value can't exhaust the server. */
export function clampTake(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(n), PAGE_SIZE), MAX_TAKE);
}

// ---------------------------------------------------------------------------
// Ordering expressions
//
// Last name is not a column on crm_households — it lives on the primary
// contact row. Drizzle's relational query API can't ORDER BY a joined child
// table, so each of these is a correlated subquery. `${crmHouseholds.id}`
// renders as `"crmHouseholds"."id"`, matching the alias Drizzle generates for
// the base table.
//
// The primary subqueries are deterministic without an inner ORDER BY because
// `crm_contacts_one_primary_per_household` is UNIQUE(household_id) WHERE
// role = 'primary'. `crm_contacts_one_spouse_per_household` is the matching
// UNIQUE(household_id) WHERE role = 'spouse', so the spouse subqueries are
// deterministic on the same grounds.
// ---------------------------------------------------------------------------

const primaryLast = sql`(select c.last_name from crm_household_contacts c
  where c.household_id = ${crmHouseholds.id} and c.role = 'primary' limit 1)`;
const primaryFirst = sql`(select c.first_name from crm_household_contacts c
  where c.household_id = ${crmHouseholds.id} and c.role = 'primary' limit 1)`;
const spouseLast = sql`(select c.last_name from crm_household_contacts c
  where c.household_id = ${crmHouseholds.id} and c.role = 'spouse' limit 1)`;
const spouseFirst = sql`(select c.first_name from crm_household_contacts c
  where c.household_id = ${crmHouseholds.id} and c.role = 'spouse' limit 1)`;

/**
 * Nulls last in BOTH directions — a household with no primary contact should
 * never occupy the top of the list, whichever way the column is sorted.
 */
function dirWithNullsLast(expr: SQL, dir: SortDir): SQL {
  return dir === "asc" ? sql`${expr} asc nulls last` : sql`${expr} desc nulls last`;
}

/** Final tie-break. Required for offset stability under "Load more". */
const idTieBreak = sql`${crmHouseholds.id} asc`;

export function buildOrderBy(key: ClientSortKey, dir: SortDir): SQL[] {
  const d = (expr: SQL) => dirWithNullsLast(expr, dir);
  switch (key) {
    // The Name column reads "John & Jane Cooper" but sorts on the LAST name.
    case "name":
      return [d(primaryLast), d(primaryFirst), idTieBreak];
    // The Primary contact cell reads "John Cooper", so it sorts on FIRST name.
    // Deliberately a different key from `name` — were both to sort on last
    // name, one of the two headers would be decorative.
    case "primary":
      return [d(primaryFirst), d(primaryLast), idTieBreak];
    case "spouse":
      return [d(spouseFirst), d(spouseLast), idTieBreak];
    // Postgres sorts enums by declaration order, and crmHouseholdStatusEnum is
    // declared prospect → active → inactive → archived. That is lifecycle
    // order, which beats alphabetical (active, archived, inactive, prospect).
    case "status":
      return [d(sql`${crmHouseholds.status}`), idTieBreak];
    case "updated":
      return [d(sql`${crmHouseholds.updatedAt}`), idTieBreak];
  }
}
