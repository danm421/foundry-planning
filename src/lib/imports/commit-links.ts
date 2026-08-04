/**
 * Row → canonical-record links, and the rules for carrying them across a
 * commit.
 *
 * A commit stamps each created record's id onto the payload row it came from
 * (`linkCreated`), so a later commit UPDATEs that record instead of inserting a
 * second copy. Both review UIs hold their own copy of the payload in React
 * state and PATCH it wholesale before every commit — and that PATCH replaces
 * `payloadJson.payload` outright — so each must adopt the links the commit just
 * wrote or the next PATCH ships a link-less payload and the commit after it
 * duplicates everything.
 *
 * Everything here is pure and React-free so both wizards share one
 * implementation. The section list below is the single source of truth for
 * "which payload sections carry links": a surface that iterates it cannot
 * silently miss a section the way two hand-written lists did.
 */
import type { CommitTab } from "./commit/types";
import type { Annotated, ImportPayload } from "./types";

/** Payload sections whose rows carry an `Annotated.match` link. */
export const LINKED_SECTIONS = [
  "dependents",
  "accounts",
  "incomes",
  "expenses",
  "liabilities",
  "lifePolicies",
  "wills",
  "entities",
  "savings",
] as const;

export type LinkedSection = (typeof LINKED_SECTIONS)[number];

/**
 * The payload section each commit tab writes links into. Tabs absent from this
 * map (`plan-basics`, `clients-identity`) write plan-level fields, not rows.
 *
 * `goals` is deliberately absent: its two sub-arrays live under `payload.goals`
 * rather than at the top level, so they are handled explicitly by
 * `unlinkForCommitTabs` instead of through the flat section list.
 */
export const SECTION_BY_COMMIT_TAB: Partial<Record<CommitTab, LinkedSection>> = {
  "family-members": "dependents",
  accounts: "accounts",
  incomes: "incomes",
  expenses: "expenses",
  liabilities: "liabilities",
  "life-insurance": "lifePolicies",
  wills: "wills",
  entities: "entities",
  savings: "savings",
};

/**
 * A row's cheap identity, used to sanity-check positional adoption. Every
 * annotated row shape has exactly one of these.
 */
function rowLabel(row: unknown): string {
  const r = row as { name?: unknown; firstName?: unknown; accountName?: unknown; grantor?: unknown };
  const raw = r.name ?? r.accountName ?? r.firstName ?? r.grantor;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Copy the links from a server-returned section onto the client's own rows.
 *
 * Matched positionally — commit mutates the payload arrays in place and never
 * reorders them — but positional alone is not safe enough on its own: the
 * review steps let an advisor add or remove rows while a commit is in flight,
 * and a length-preserving edit (one removed, one added) would otherwise make
 * row `i` adopt a different record's id and send the NEXT commit to update the
 * wrong database row. So the label must agree too; a row that fails the check
 * simply keeps its old link. The worst case degrades to "no link adopted" — a
 * possible duplicate, which the advisor can see — never a silent write to
 * someone else's record.
 */
export function adoptMatches<T>(
  prev: Annotated<T>[],
  next: Annotated<T>[] | undefined,
): Annotated<T>[] {
  if (!next || next.length !== prev.length) return prev;
  let changed = false;
  const out = prev.map((row, i) => {
    const incoming = next[i];
    if (!incoming?.match) return row;
    if (rowLabel(row) !== rowLabel(incoming)) return row;
    changed = true;
    return { ...row, match: incoming.match };
  });
  return changed ? out : prev;
}

/**
 * Apply `adoptMatches` across every linked section, returning the sections that
 * actually changed. Callers map the result onto their own state setters; a
 * section a given surface does not hold in state is simply ignored by that
 * caller, but it is never missing from the iteration.
 */
export function adoptPayloadMatches(
  prev: ImportPayload,
  server: ImportPayload | undefined,
): ImportPayload {
  if (!server) return prev;
  const next: ImportPayload = { ...prev };
  for (const section of LINKED_SECTIONS) {
    // Each section holds a different row type; the shared helper is generic
    // over that, so the cast only re-widens what the index signature lost.
    (next[section] as unknown) = adoptMatches(
      prev[section] as Annotated<unknown>[],
      server[section] as Annotated<unknown>[] | undefined,
    );
  }
  if (prev.goals && server.goals) {
    next.goals = {
      ...prev.goals,
      education: adoptMatches(prev.goals.education, server.goals.education),
      homePurchases: adoptMatches(prev.goals.homePurchases, server.goals.homePurchases),
    };
  }
  return next;
}

/**
 * Clear the links on a set of rows so the next commit INSERTs fresh records
 * instead of updating the ones already created — the "commit as new" path.
 *
 * Returns a new array; the rows are the same objects the wizards hold in React
 * state, so mutating them in place would desync the UI.
 *
 * `fuzzy` rows are left alone: they carry unresolved candidates, not a link,
 * and forcing them to "new" would create exactly the duplicate the advisor is
 * being asked to rule on.
 */
export function unlinkRows<T>(rows: Annotated<T>[]): Annotated<T>[] {
  return rows.map((row) =>
    row.match?.kind === "exact" ? { ...row, match: { kind: "new" as const } } : row,
  );
}

/** True when this tab has any link to clear — gates the "Commit as new" affordance. */
export function tabHasLinkedSection(tabs: readonly CommitTab[]): boolean {
  return tabs.some((t) => SECTION_BY_COMMIT_TAB[t] != null || t === "goals");
}

/**
 * Return a copy of `payload` with the links cleared for every section the given
 * commit tabs write, so the commit creates a second set of records.
 */
export function unlinkForCommitTabs(
  payload: ImportPayload,
  tabs: readonly CommitTab[],
): ImportPayload {
  const next: ImportPayload = { ...payload };
  for (const tab of tabs) {
    const section = SECTION_BY_COMMIT_TAB[tab];
    if (section) {
      (next[section] as unknown) = unlinkRows(next[section] as Annotated<unknown>[]);
    }
    if (tab === "goals" && next.goals) {
      next.goals = {
        ...next.goals,
        education: unlinkRows(next.goals.education),
        homePurchases: unlinkRows(next.goals.homePurchases),
      };
    }
  }
  return next;
}
