// Deliberately dependency-free: `clients-sort-header.tsx` and
// `clients-load-more.tsx` are client components and import from this module,
// so nothing here may pull in `@/db`. The ORDER BY expressions, which do need
// the schema, live in the server-only sibling `sort-order.ts`.

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
