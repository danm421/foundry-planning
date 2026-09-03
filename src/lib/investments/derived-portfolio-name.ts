// Model portfolio names are unique per firm (`model_portfolios_firm_id_name_unique`),
// and a fund portfolio's name is only unique among *fund* portfolios. Promoting
// "Balanced" when a hand-built "Balanced" already exists would throw a raw
// constraint violation at the advisor, so pick a free name instead.
//
// Pure — no DB. The caller supplies the firm's existing names.

/** The first free name in the series `name`, `name (fund)`, `name (fund 2)`, … */
export function freeModelPortfolioName(desired: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  if (!used.has(desired.trim().toLowerCase())) return desired;

  const withSuffix = `${desired} (fund)`;
  if (!used.has(withSuffix.toLowerCase())) return withSuffix;

  // Bounded: a firm with 99 same-named portfolios has a naming problem of its
  // own, and an unbounded loop here would hang the request.
  for (let n = 2; n < 100; n++) {
    const candidate = `${desired} (fund ${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${desired} (fund ${Date.now()})`;
}
