// src/lib/like-pattern.ts
//
// Drizzle parameterizes the *value* passed to `ilike(col, pattern)` / an
// `ILIKE ${pattern}` template, so none of this is about SQL injection — the
// string never reaches the parser. It is about the LIKE *grammar*: `%` and `_`
// are wildcards inside that parameter, so raw user text spliced into
// `%...%` silently changes which rows the predicate selects.
//
// Reading that off is a nuisance (a search for "50%" matches everything).
// Writing it off is not: `applyRuleRetroactively` / `claimRecurringRetroactively`
// use the same predicate to drive a bulk UPDATE, so a rule saved with the
// pattern `%` re-categorizes every transaction the client owns rather than the
// merchant they typed.
//
// Postgres' LIKE assumes `\` as the escape character when no ESCAPE clause is
// given, so escaping here needs no change at the call sites.

const LIKE_METACHARACTERS = /[\\%_]/g;

/** Escapes `\`, `%` and `_` so the text matches literally under LIKE/ILIKE. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(LIKE_METACHARACTERS, (c) => `\\${c}`);
}

/** `%literal%` — a substring match on user-supplied text. */
export function containsPattern(raw: string): string {
  return `%${escapeLikePattern(raw)}%`;
}
