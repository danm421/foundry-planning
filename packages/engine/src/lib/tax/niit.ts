export interface NiitInput {
  magi: number;
  investmentIncome: number;
  threshold: number;
  rate: number;
}

/**
 * NIIT: 3.8% of the lesser of (net investment income) or (MAGI - threshold).
 * Thresholds statutorily fixed: $250k MFJ, $200k single/HoH, $125k MFS.
 */
export function calcNiit(input: NiitInput): number {
  const excess = Math.max(0, input.magi - input.threshold);
  if (excess === 0 || input.investmentIncome <= 0) return 0;
  return Math.min(input.investmentIncome, excess) * input.rate;
}
