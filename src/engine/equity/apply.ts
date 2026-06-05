import type { EquityYearResult } from "./tax-events";

export interface ApplyEquityOutput {
  taxDeltas: { ordinaryIncome: number; capitalGains: number; stCapitalGains: number; isoSpread: number };
  netCashToChecking: number;
}

/** Mutates `accountBalances` / `basisMap` for the destination account, routes
 *  cash through checking, and returns the tax numbers to fold into taxDetail. */
export function applyEquityYear(
  result: EquityYearResult,
  destinationAccountId: string,
  accountBalances: Record<string, number>,
  basisMap: Record<string, number>,
  checkingId: string,
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
  // Cash: proceeds in, strike out.
  const netCash = result.sellProceeds + result.sellToCoverProceeds - result.strikeCashOutflow;
  accountBalances[checkingId] = (accountBalances[checkingId] ?? 0) + netCash;

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
