import type { Account, AccountLedger, MarginCallWarning } from "./types";

/**
 * Margin loans on taxable accounts (spec 2026-10-13).
 *
 * Invariant: for a margined account the projection's `accountBalances[id]` is
 * NET value and `marginMap[id]` is the live loan; the securities position
 * (gross) is their sum. Everything that reads a projected account value —
 * balance sheet, net worth, estate, Monte Carlo — therefore sees net. Only the
 * math that needs the securities value reads the loan: growth, market shock,
 * sale-gain ratios, step-up, and splits.
 */
export type MarginMap = Record<string, number>;

/** Default margin-call warning level (net ÷ securities). The DB column default
 *  `'0.3'` and the account form's "30" display stay literal — keep them in step. */
export const DEFAULT_MARGIN_CALL_PCT = 0.3;

/** Plan-start `accountBalances` seed: the securities value net of the loan. */
export function netSeedValue(acct: Account): number {
  return acct.value - (acct.marginBalance ?? 0);
}

/** Record an account's own loan in `marginMap` — only when it carries one, so
 *  a no-margin account never gains a map entry. */
export function seedMarginLoan(
  marginMap: MarginMap,
  acct: Pick<Account, "id" | "marginBalance">,
): void {
  if ((acct.marginBalance ?? 0) > 0) marginMap[acct.id] = acct.marginBalance!;
}

/** Securities value: net balance plus the live loan (net itself when there is none). */
export function grossValue(net: number, marginMap: MarginMap | undefined, accountId: string): number {
  return net + (marginMap?.[accountId] ?? 0);
}

/** Gross balances for every account carrying a loan — the denominator for
 *  gain ratios. Accounts without a loan are absent; callers fall back to the
 *  net balance, which equals gross for them. */
export function grossBalancesFor(
  accountBalances: Record<string, number>,
  marginMap: MarginMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, loan] of Object.entries(marginMap)) {
    if (loan > 0) out[id] = (accountBalances[id] ?? 0) + loan;
  }
  return out;
}

/** Charge one year's margin interest: added to the loan, taken out of net.
 *  An annual charge on the opening loan — a deliberate approximation of the
 *  brokerage's daily accrual / monthly posting. Returns the interest. */
export function chargeMarginInterest(
  acct: Pick<Account, "id" | "marginInterestRate">,
  accountBalances: Record<string, number>,
  marginMap: MarginMap,
  ledger: AccountLedger | undefined,
): number {
  const loan = marginMap[acct.id] ?? 0;
  const rate = acct.marginInterestRate ?? 0;
  if (loan <= 0 || rate <= 0) return 0;
  const interest = loan * rate;
  marginMap[acct.id] = loan + interest;
  accountBalances[acct.id] = (accountBalances[acct.id] ?? 0) - interest;
  if (ledger) {
    ledger.marginInterest = (ledger.marginInterest ?? 0) + interest;
    ledger.endingValue -= interest;
    ledger.entries.push({
      category: "margin_interest",
      label: `Margin interest (${(rate * 100).toFixed(2)}%)`,
      amount: -interest,
      basis: 0,
    });
  }
  return interest;
}

/** The death path reads loans off Account objects: swap in the live loan. */
export function withLiveMargin(acct: Account, marginMap: MarginMap | undefined): Account {
  const loan = marginMap?.[acct.id];
  return loan == null ? acct : { ...acct, marginBalance: loan };
}

/** A `fraction` share of an account: value, basis AND loan scale together.
 *  Any share-of-an-account copy must scale the loan too (this helper, or the
 *  inline loan scaling in `splitAccount` / `partitionMixedAccount`) — a bare
 *  `{ ...source, value: source.value * f }` copies the WHOLE loan. */
export function scaleAccountValue(source: Account, fraction: number): Account {
  return {
    ...source,
    value: source.value * fraction,
    basis: source.basis * fraction,
    ...(source.marginBalance != null ? { marginBalance: source.marginBalance * fraction } : {}),
  };
}

/** Year-end check (spec: warn only — nothing is sold). */
export function marginCallWarnings(
  accounts: Account[],
  accountBalances: Record<string, number>,
  marginMap: MarginMap,
): MarginCallWarning[] {
  const out: MarginCallWarning[] = [];
  for (const acct of accounts) {
    const loan = marginMap[acct.id] ?? 0;
    if (loan <= 0) continue;
    const net = accountBalances[acct.id] ?? 0;
    const gross = net + loan;
    const ratio = net > 0 && gross > 0 ? net / gross : 0;
    const threshold = acct.marginCallPct ?? DEFAULT_MARGIN_CALL_PCT;
    if (ratio < threshold) out.push({ accountId: acct.id, ratio, threshold });
  }
  return out;
}
