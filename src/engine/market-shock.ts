// src/engine/market-shock.ts
//
// Stress test — one-time market crash. Pure helper that writes down
// market-exposed account balances IN PLACE for a single projection year.
// Called from projection.ts after the growth pass so the reduced balance
// feeds RMDs, withdrawals, and taxes, and compounds forward off the lower
// base in every Monte Carlo trial (which runs the same runProjection).

import type { Account, AccountLedger } from "./types";

/** Account categories treated as market-exposed for a crash drawdown.
 *  Includes education_savings (529s are invested accounts). Excludes cash,
 *  real_estate, business, life_insurance, annuity, notes_receivable, and
 *  stock_options (illiquid / non-market). */
export const MARKET_EXPOSED_CATEGORIES: ReadonlySet<Account["category"]> =
  new Set<Account["category"]>(["taxable", "retirement", "education_savings"]);

export interface MarketShock {
  year: number;
  drawdownPct: number;
}

/**
 * Multiplies every market-exposed account balance by (1 − drawdownPct) when
 * `year` matches the shock year. Records the negative delta as a growth ledger
 * entry AND in `ledger.growth` — every "Portfolio Growth" surface reads that
 * scalar rather than summing entries, so leaving it alone makes the crash year
 * render a normal positive growth number with the crash visible only in the
 * drill-down underneath it.
 *
 * `rothValueMap` is written down by the same factor: it tracks the balance so
 * the Roth-designated fraction of a 401(k)/403(b) holds constant absent
 * contributions or withdrawals. Skipping it leaves the Roth slice larger than
 * the account itself, which zeroes the pre-tax RMD basis
 * (`Math.max(0, balance − rothValue)`) for every remaining year.
 *
 * No-op when the shock is absent, the year doesn't match, or the drawdown is
 * non-positive. Cost basis is intentionally left unchanged — a paper drawdown
 * does not realize a loss in this model.
 */
export function applyMarketShock(
  accountBalances: Record<string, number>,
  accounts: Account[],
  year: number,
  shock: MarketShock | undefined,
  accountLedgers: Record<string, AccountLedger>,
  rothValueMap: Record<string, number>,
): void {
  if (!shock || year !== shock.year || !(shock.drawdownPct > 0)) return;
  const factor = Math.max(0, 1 - shock.drawdownPct);
  const pctLabel = `${Math.round(shock.drawdownPct * 100)}% drawdown`;
  for (const acct of accounts) {
    if (!MARKET_EXPOSED_CATEGORIES.has(acct.category)) continue;
    const before = accountBalances[acct.id] ?? 0;
    if (before === 0) continue;
    const after = before * factor;
    const delta = after - before; // negative
    accountBalances[acct.id] = after;
    if (rothValueMap[acct.id] > 0) rothValueMap[acct.id] *= factor;
    const ledger = accountLedgers[acct.id];
    if (ledger) {
      ledger.growth += delta;
      ledger.endingValue += delta;
      ledger.entries.push({
        category: "growth",
        label: `Market shock (${pctLabel})`,
        amount: delta,
        basis: 0,
      });
    }
  }
}
