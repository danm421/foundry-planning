// mobile/src/api/query.ts
//
// Pure transactions query-string builder. Uses encodeURIComponent (not
// URLSearchParams) so encoding is deterministic (%20 for spaces) in both
// vitest (Node) and the RN runtime (Hermes) — URLSearchParams encodes
// spaces as `+` under Node, which would diverge from Hermes' `%20`.

export interface TxnQuery {
  limit: number;
  offset: number;
  q?: string;
  categoryId?: string;
  accountId?: string;
  from?: string;         // YYYY-MM-DD
  to?: string;
  reviewed?: boolean;    // false = unreviewed only; omit = both
}

export function buildTransactionsQuery(p: TxnQuery): string {
  const parts: string[] = [];
  const add = (k: string, v: string) => parts.push(`${k}=${encodeURIComponent(v)}`);
  add("limit", String(p.limit));
  add("offset", String(p.offset));
  if (p.q && p.q.trim()) add("q", p.q.trim());
  if (p.categoryId) add("categoryId", p.categoryId);
  if (p.accountId) add("accountId", p.accountId);
  if (p.from) add("from", p.from);
  if (p.to) add("to", p.to);
  if (p.reviewed !== undefined) add("reviewed", String(p.reviewed));
  return `?${parts.join("&")}`;
}
