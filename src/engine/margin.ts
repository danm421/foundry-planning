import type { Account, AccountLedger, MarginCallWarning, MarginSale } from "./types";
import { categorizeDraw } from "./withdrawal";

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

/** "At the call level" tolerance: a forced sale restores net ÷ securities to
 *  exactly the call level, which floating point can land a hair either side. */
const RATIO_EPSILON = 1e-9;

/** Plan-start `accountBalances` seed: the securities value net of the loan. */
export function netSeedValue(acct: Account): number {
  return acct.value - (acct.marginBalance ?? 0);
}

/** Record an account's loan in `marginMap` — only when it carries one, so a
 *  no-margin account never gains a map entry — and, with `shareMap`, its
 *  personal-use share (spec 2026-10-14). */
export function seedMarginLoan(
  marginMap: MarginMap,
  acct: Pick<Account, "id" | "marginBalance" | "marginPersonalShare">,
  shareMap?: MarginShareMap,
): void {
  if ((acct.marginBalance ?? 0) <= 0) return;
  marginMap[acct.id] = acct.marginBalance!;
  if (shareMap && (acct.marginPersonalShare ?? 0) > 0) shareMap[acct.id] = acct.marginPersonalShare!;
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

/** Growth that reached the account's NET value: gross growth less the year's
 *  margin interest, which is capitalized onto the loan with no ledger flow.
 *  `ledger.growth` itself stays gross (family-cashflow and realization read
 *  it); every display that walks BoY + growth + activity = EoY reads this.
 *  Equals `ledger.growth` for an account without a loan. */
export function netGrowthOf(ledger: Pick<AccountLedger, "growth" | "marginInterest">): number {
  return ledger.growth - (ledger.marginInterest ?? 0);
}

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

/** Charge one year's margin interest: added to the loan, taken out of net.
 *  An annual charge on the opening loan — a deliberate approximation of the
 *  brokerage's daily accrual / monthly posting. `personalShare` (the loan's
 *  personal-use share) is the part that is not deductible: the ledger records
 *  it and the interest line notes it (spec 2026-10-14). Returns the interest. */
export function chargeMarginInterest(
  acct: Pick<Account, "id" | "marginInterestRate">,
  accountBalances: Record<string, number>,
  marginMap: MarginMap,
  ledger: AccountLedger | undefined,
  personalShare = 0,
): number {
  const loan = marginMap[acct.id] ?? 0;
  const rate = acct.marginInterestRate ?? 0;
  if (loan <= 0 || rate <= 0) return 0;
  const interest = loan * rate;
  marginMap[acct.id] = loan + interest;
  accountBalances[acct.id] = (accountBalances[acct.id] ?? 0) - interest;
  if (ledger) {
    const personal = interest * personalShare;
    ledger.marginInterest = (ledger.marginInterest ?? 0) + interest;
    if (personal > 0) ledger.marginInterestPersonal = personal;
    ledger.endingValue -= interest;
    ledger.entries.push({
      category: "margin_interest",
      label: `Margin interest (${(rate * 100).toFixed(2)}%)` +
        (personal > 0 ? ` — ${wholeDollars.format(personal)} not deductible (borrowed for spending)` : ""),
      amount: -interest,
      basis: 0,
    });
  }
  return interest;
}

/** The death path reads loans off Account objects: swap in the live loan and,
 *  with `shareMap`, the live personal-use share, so every slice minted from
 *  the copy carries both. A share left on the object by an earlier death is
 *  cleared when the live map has none.
 *
 *  With a live map, an account it leaves out has NO loan — a paid-off loan
 *  leaves the map (R8) — so the plan-start `marginBalance` on the object must
 *  not come back. Only with no map at all (a fixture) does the object's own
 *  loan stand. An account without the field is returned as it is. */
export function withLiveMargin(acct: Account, marginMap: MarginMap | undefined, shareMap?: MarginShareMap): Account {
  if (marginMap == null) return acct;
  const loan = marginMap[acct.id];
  if (loan == null && acct.marginBalance == null) return acct;
  const live: Account = { ...acct, marginBalance: loan ?? 0 };
  const share = shareMap?.[acct.id];
  if (share != null) live.marginPersonalShare = share;
  else if (acct.marginPersonalShare != null) live.marginPersonalShare = 0;
  return live;
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

/** Year-end check: flags a breach; the forced sale runs at next year's call
 *  check (spec 2026-10-14 step 8). */
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
    if (ratio < threshold - RATIO_EPSILON) out.push({ accountId: acct.id, ratio, threshold });
  }
  return out;
}

// ── Phase 2: borrowing to cover spending (spec 2026-10-14) ──────────────────

/** Reg T (12 CFR 220.12) initial margin: new borrowing may not take the loan
 *  above half the securities. */
export const REG_T_INITIAL_MARGIN = 0.5;

/** Personal-use share of each loan: personal-use dollars ÷ loan, in (0, 1].
 *  Absent ⇒ 0 — the whole loan is investment debt, as in Phase 1. Interest
 *  leaves it unchanged (§1.163-8T(c)(2)(ii)(B)); borrowing for spending raises
 *  it; any repayment lowers it, personal-use first (§1.163-8T(d)(1)). The
 *  death path carries it on `Account.marginPersonalShare` (`withLiveMargin`). */
export type MarginShareMap = Record<string, number>;

/** A share at or below RATIO_EPSILON is float residue (a repayment of exactly
 *  the personal-use dollars leaves ~1e-16), not personal-use debt. */
function setShare(shareMap: MarginShareMap, id: string, share: number): void {
  if (share > RATIO_EPSILON) shareMap[id] = share;
  else delete shareMap[id];
}

/** The share after borrowing `borrowed` more for spending. */
export function shareAfterBorrow(share: number, loan: number, borrowed: number): number {
  const total = loan + borrowed;
  return total > 0 ? (share * loan + borrowed) / total : 0;
}

/** The share after repaying `repaid` of a `loanBefore` loan, personal-use first. */
export function shareAfterRepayment(share: number, loanBefore: number, repaid: number): number {
  const loanAfter = loanBefore - repaid;
  if (loanAfter <= 0) return 0;
  return Math.max(0, share * loanBefore - repaid) / loanAfter;
}

/** Re-derive one account's share after its loan fell from `loanBefore` to
 *  `loanAfter` by repayment. A no-op for an account without a share. */
export function settleShareAfterRepayment(
  shareMap: MarginShareMap, id: string, loanBefore: number, loanAfter: number,
): void {
  const share = shareMap[id];
  if (share == null) return;
  if (loanAfter <= 0) { delete shareMap[id]; return; }
  if (loanAfter >= loanBefore) return;
  setShare(shareMap, id, shareAfterRepayment(share, loanBefore, loanBefore - loanAfter));
}

/** The loans of every account that carries a share — snapshot before a step
 *  that may repay loans (asset and business sales), settle after it. */
export function loansOfSharedAccounts(marginMap: MarginMap, shareMap: MarginShareMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(shareMap)) out[id] = marginMap[id] ?? 0;
  return out;
}

/** Settle every share snapshotted by `loansOfSharedAccounts` against the loan
 *  it now has (`settleShareAfterRepayment` for each). */
export function settleSharesAfterRepayments(
  shareMap: MarginShareMap, loansBefore: Record<string, number>, marginMap: MarginMap,
): void {
  for (const [id, before] of Object.entries(loansBefore)) {
    settleShareAfterRepayment(shareMap, id, before, marginMap[id] ?? 0);
  }
}

/** How much more the plan may borrow on an account: up to Reg T's half of the
 *  securities, or less when the account's call level is above 50% — so
 *  borrowing alone can never trigger a call. */
export function marginBorrowHeadroom(gross: number, loan: number, callPct: number): number {
  return Math.max(0, (1 - Math.max(REG_T_INITIAL_MARGIN, callPct)) * gross - loan);
}

/** Whether the plan may borrow on `acct` in `year`: the switch is on, it is
 *  Taxable, the household owns all of it this year (a trust's or business's
 *  share never borrows for household spending — R1), and the year is inside
 *  [marginBorrowStartYear, marginRepayYear). */
export function canBorrowOnMargin(acct: Account, year: number, householdShare: number): boolean {
  if (acct.marginBorrowEnabled !== true || acct.category !== "taxable") return false;
  if (householdShare < 1 - RATIO_EPSILON) return false;
  if (acct.marginBorrowStartYear != null && year < acct.marginBorrowStartYear) return false;
  if (acct.marginRepayYear != null && year >= acct.marginRepayYear) return false;
  return true;
}

export interface MarginBorrowSource {
  accountId: string;
  /** Most the plan may borrow on it this year. */
  headroom: number;
  rate: number;
}

/** This year's borrowing sources, cheapest first (ties: most headroom first). */
export function marginBorrowSourcesFor(input: {
  accounts: Account[];
  year: number;
  accountBalances: Record<string, number>;
  marginMap: MarginMap;
  householdShareOf: (acct: Account) => number;
}): MarginBorrowSource[] {
  const out: MarginBorrowSource[] = [];
  for (const acct of input.accounts) {
    // The switch first: it skips the ownership walk for every account that
    // never borrows — every year, every Monte Carlo trial.
    if (acct.marginBorrowEnabled !== true) continue;
    if (!canBorrowOnMargin(acct, input.year, input.householdShareOf(acct))) continue;
    const loan = input.marginMap[acct.id] ?? 0;
    const gross = (input.accountBalances[acct.id] ?? 0) + loan;
    const headroom = marginBorrowHeadroom(gross, loan, acct.marginCallPct ?? DEFAULT_MARGIN_CALL_PCT);
    if (headroom > 0) out.push({ accountId: acct.id, headroom, rate: acct.marginInterestRate ?? 0 });
  }
  return out.sort((a, b) => a.rate - b.rate || b.headroom - a.headroom);
}

/** Apply one converged borrow: the loan grows, net falls, the securities and
 *  basis are untouched, and the share moves toward personal. The cash itself
 *  is credited to checking by the caller with the rest of the year's draws. */
export function borrowOnMargin(input: {
  accountId: string;
  amount: number;
  accountBalances: Record<string, number>;
  marginMap: MarginMap;
  shareMap: MarginShareMap;
  ledger: AccountLedger | undefined;
  checkingId: string;
}): void {
  const { accountId, amount, accountBalances, marginMap, shareMap, ledger } = input;
  const loan = marginMap[accountId] ?? 0;
  setShare(shareMap, accountId, shareAfterBorrow(shareMap[accountId] ?? 0, loan, amount));
  marginMap[accountId] = loan + amount;
  accountBalances[accountId] = (accountBalances[accountId] ?? 0) - amount;
  if (ledger) {
    ledger.distributions += amount;
    ledger.endingValue -= amount;
    ledger.entries.push({
      category: "margin_borrow",
      label: "Borrowed on margin",
      amount: -amount,
      counterpartyId: input.checkingId,
      basis: 0,
    });
  }
}

/** Securities, or a sale, worth less than a cent count as none: selling every
 *  security leaves float residue (~1e-12) that must not book a "sold $0"
 *  margin call the next year (final review I2). */
export const SUB_CENT = 0.01;

/** Securities to sell on a margin call: enough to bring net ÷ securities back
 *  to `callPct`; every security when net ≤ 0; 0 when the account complies or
 *  has no securities left. */
export function marginCallSaleAmount(net: number, loan: number, callPct: number): number {
  if (loan <= 0 || callPct <= 0) return 0;
  const gross = net + loan;
  if (gross < SUB_CENT) return 0;
  if (net <= 0) return gross;
  if (net / gross >= callPct - RATIO_EPSILON) return 0;
  return gross - net / callPct;
}

/** Sell up to `amount` of an account's securities and pay the loan down with
 *  the proceeds (spec 2026-10-14 steps 4–5). Net is unchanged: every dollar
 *  sold repays a dollar of loan. The gain uses the securities-value ratio
 *  (this year's fresh basis first), basis falls by the basis sold, and the
 *  share settles personal-use first. A loan paid to $0 leaves the map (R8). */
export function sellSecuritiesToRepayLoan(input: {
  acct: Account;
  reason: "call" | "repay";
  amount: number;
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  freshBasisMap: Record<string, number>;
  marginMap: MarginMap;
  shareMap: MarginShareMap;
  ledger: AccountLedger | undefined;
}): MarginSale | null {
  const { acct, reason, accountBalances, basisMap, freshBasisMap, marginMap, shareMap, ledger } = input;
  const loan = marginMap[acct.id] ?? 0;
  const gross = (accountBalances[acct.id] ?? 0) + loan;
  const sold = Math.min(input.amount, loan, gross);
  if (sold < SUB_CENT) return null;

  const fresh = freshBasisMap[acct.id] ?? 0;
  // `balance: gross` — the sale is of securities; net may be ≤ 0 here.
  const draw = categorizeDraw({
    account: acct, amount: sold, balance: gross, grossBalance: gross,
    basisMap, freshBasisRemaining: fresh, ownerAge: 0,
  });
  const basisBefore = basisMap[acct.id] ?? 0;
  const basisMoved = Math.min(draw.basisReturn, basisBefore);
  basisMap[acct.id] = basisBefore - basisMoved;
  if (fresh > 0) freshBasisMap[acct.id] = fresh - Math.min(fresh, sold);

  const loanAfter = loan - sold;
  if (loanAfter > 0) marginMap[acct.id] = loanAfter;
  else delete marginMap[acct.id];
  settleShareAfterRepayment(shareMap, acct.id, loan, loanAfter);

  if (ledger) {
    ledger.entries.push({
      category: "margin_sale",
      label: reason === "call" ? "Sold to meet margin call" : "Sold to repay margin loan",
      amount: -sold,
      basis: basisMoved === 0 ? 0 : -basisMoved,
    });
    ledger.entries.push({ category: "margin_paydown", label: "Margin loan paid down", amount: sold, basis: 0 });
    // Display-only realization detail, as transfers and withdrawals record it.
    const detail = ledger.withdrawalDetail ?? { realizedLtcg: 0, basisReturn: 0 };
    ledger.withdrawalDetail = {
      realizedLtcg: detail.realizedLtcg + draw.capitalGains,
      basisReturn: detail.basisReturn + draw.basisReturn,
    };
  }
  return { accountId: acct.id, reason, sold, gain: draw.capitalGains };
}
