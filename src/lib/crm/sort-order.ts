import { sql, type SQL } from "drizzle-orm";
import { crmHouseholds } from "@/db/schema";
import type { ClientSortKey, SortDir } from "./sort";

// ---------------------------------------------------------------------------
// Ordering expressions
//
// Split out of `sort.ts` because this half imports `@/db/schema`, and `sort.ts`
// is imported by client components (clients-sort-header, clients-load-more).
// Keeping the SQL here is what lets `sort.ts` stay dependency-free, the same
// way `trash.ts` is — see the note in book-switcher.tsx about @/db never
// reaching a client bundle.
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

/** Final tie-break. Keeps the page-N prefix stable as the LIMIT grows. */
const idTieBreak = sql`${crmHouseholds.id} asc`;

export function buildOrderBy(key: ClientSortKey, dir: SortDir): SQL[] {
  const d = (expr: SQL) => dirWithNullsLast(expr, dir);
  switch (key) {
    // The Name column reads "John & Jane Cooper" but sorts on the LAST name.
    case "name":
      return [d(primaryLast), d(primaryFirst), idTieBreak];
    // The Primary and Spouse cells read "Cooper, John", so they sort on LAST
    // name — sorting a surname-first column by the first name reads as unsorted.
    // That makes `primary` order the same way as `name` whenever the household
    // name was derived from the primary contact; the two stay separate keys
    // because a renamed household breaks that coupling, and because Spouse
    // (whose surname can differ) needs the same treatment to make sense.
    case "primary":
      return [d(primaryLast), d(primaryFirst), idTieBreak];
    case "spouse":
      return [d(spouseLast), d(spouseFirst), idTieBreak];
    // Postgres sorts enums by declaration order, and crmHouseholdStatusEnum is
    // declared prospect → active → inactive → archived. That is lifecycle
    // order, which beats alphabetical (active, archived, inactive, prospect).
    case "status":
      return [d(sql`${crmHouseholds.status}`), idTieBreak];
    case "updated":
      return [d(sql`${crmHouseholds.updatedAt}`), idTieBreak];
  }
}
