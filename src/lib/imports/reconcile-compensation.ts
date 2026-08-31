// src/lib/imports/reconcile-compensation.ts
//
// Deterministic compensation reconciliation. PURE: no Date, no Math.random, no
// DB, no framework imports — `currentYear` is always a parameter. The import
// mergers document themselves as deterministic; this module must not break that.

/** One reconciled figure. `display` is pre-rounded on purpose — see the module
 *  header in the spec: Forge's grounding check compares digit strings exactly,
 *  so the string Forge is expected to write must itself be in the payload. */
export type Money = {
  amount: number;
  display: string;
  basis: string;
  fromFiles: string[];
};

/** Whole-dollar, comma-grouped, matching GROUNDING_RULES' "$X,XXX" form.
 *  Rounds the magnitude (round-half-away-from-zero) then prefixes the sign —
 *  `Math.round` alone breaks ties toward +Infinity, which would round
 *  -1234.5 to -1234 instead of -1235. */
export function money(amount: number, basis: string, fromFiles: string[]): Money {
  const rounded = Math.round(Math.abs(amount));
  const sign = amount < 0 && rounded !== 0 ? "-" : "";
  const display = `${sign}$${rounded.toLocaleString("en-US")}`;
  return { amount, display, basis, fromFiles };
}
