import type { EquityYearResult } from "./tax-events";

export interface ApplyEquityOutput {
  taxDeltas: { ordinaryIncome: number; capitalGains: number; stCapitalGains: number; isoSpread: number };
  netCashToChecking: number;
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
  if (result.sellProceeds > 0) {
    accountBalances[destinationAccountId] = Math.max(0, (accountBalances[destinationAccountId] ?? 0) - result.sellProceeds);
    basisMap[destinationAccountId] = Math.max(0, (basisMap[destinationAccountId] ?? 0) - result.saleBasisRemoved);
  }
  // Cash: proceeds in, strike out. NOTE: the caller routes this through
  // creditCash (deferred cashDelta path) so Portfolio Activity / net-cash-flow
  // see it exactly once; applyEquityYear no longer mutates checking directly.
  const netCash = result.sellProceeds + result.sellToCoverProceeds - result.strikeCashOutflow;

  return {
    taxDeltas: {
      ordinaryIncome: result.ordinaryIncome,
      capitalGains: result.capitalGains,
      stCapitalGains: result.stCapitalGains,
      isoSpread: result.isoSpread,
    },
    netCashToChecking: netCash,
  };
}
