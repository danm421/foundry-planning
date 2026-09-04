// Model portfolio names are unique per firm (`model_portfolios_firm_id_name_unique`),
// and a fund portfolio's name is only unique among *fund* portfolios. Promoting
// "Balanced" when a hand-built "Balanced" already exists would throw a raw
// constraint violation at the advisor, so pick a free name instead.
//
// Pure — no DB. The caller supplies the firm's existing names.

/** The first free name in the series `name`, `name (fund)`, `name (fund 2)`, … */
export function freeModelPortfolioName(desired: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const free = (candidate: string) => !used.has(candidate.trim().toLowerCase());

  if (free(desired)) return desired;
  if (free(`${desired} (fund)`)) return `${desired} (fund)`;
  // Terminates: `used` is finite and every candidate is distinct.
  for (let n = 2; ; n++) {
    if (free(`${desired} (fund ${n})`)) return `${desired} (fund ${n})`;
  }
}
