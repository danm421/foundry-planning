import type { EquityYearResult } from "./tax-events";

export interface ApplyEquityOutput {
  taxDeltas: { ordinaryIncome: number; ficaExemptOrdinaryIncome: number; capitalGains: number; stCapitalGains: number; isoSpread: number };
  netCashToChecking: number;
  /** Market value actually drained from the destination account this year —
   *  `result.sellProceeds` unless the account held less than the module sold.
   *  The caller posts its Portfolio Activity distribution off THIS number so
   *  the ledger and the balance cannot drift apart. */
  sellProceedsApplied: number;
}

/** Mutates `accountBalances` / `basisMap` for the destination account and
 *  returns the tax numbers plus the equity net cash to fold into taxDetail.
 *  Does NOT credit checking — the caller routes `netCashToChecking` through
 *  creditCash so net-cash-flow reporting sees it exactly once. */
export function applyEquityYear(
  result: EquityYearResult,
  destinationAccountId: string,
  accountBalances: Record<string, number>,
  basisMap: Record<string, number>,
): ApplyEquityOutput {
  // Acquisitions: in-kind inflow to the destination account.
  for (const a of result.acquisitions) {
    accountBalances[destinationAccountId] = (accountBalances[destinationAccountId] ?? 0) + a.value;
    basisMap[destinationAccountId] = (basisMap[destinationAccountId] ?? 0) + a.basis;
  }
  // Sells: drain market value + basis from the destination account.
  //
  // The destination can legitimately hold LESS than the module thinks it sold:
  // it is an ordinary taxable account, so a supplemental withdrawal may have
  // liquidated part of it first. Drain what is actually there and report the
  // rest, rather than clamping (audit F31) — a clamped debit paired with the
  // unclamped credit below manufactures cash out of nothing. Withholding the
  // unbacked slice is also the economically right answer: that value already
  // reached the household when the account was drawn down.
  //
  // The tax legs still book the gain on the full sale. Reconciling SHARE
  // COUNTS between the withdrawal engine and the equity module is the real
  // fix — see future-work/engine.md.
  let sellProceedsApplied = 0;
  if (result.sellProceeds > 0) {
    const balance = accountBalances[destinationAccountId] ?? 0;
    sellProceedsApplied = Math.min(result.sellProceeds, Math.max(0, balance));
    accountBalances[destinationAccountId] = balance - sellProceedsApplied;

    const basis = basisMap[destinationAccountId] ?? 0;
    basisMap[destinationAccountId] =
      basis - Math.min(result.saleBasisRemoved, Math.max(0, basis));
  }
  // Cash: proceeds in, strike out. NOTE: the caller routes this through
  // creditCash (deferred cashDelta path) so Portfolio Activity / net-cash-flow
  // see it exactly once; applyEquityYear no longer mutates checking directly.
  const netCash = sellProceedsApplied + result.sellToCoverProceeds - result.strikeCashOutflow;

  return {
    taxDeltas: {
      ordinaryIncome: result.ordinaryIncome,
      ficaExemptOrdinaryIncome: result.ficaExemptOrdinaryIncome,
      capitalGains: result.capitalGains,
      stCapitalGains: result.stCapitalGains,
      isoSpread: result.isoSpread,
    },
    netCashToChecking: netCash,
    sellProceedsApplied,
  };
}
