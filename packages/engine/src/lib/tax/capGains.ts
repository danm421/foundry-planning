import type { CapGainsTier } from "./types";

/**
 * Calculate LT capital gains tax (and qualified dividends, treated identically).
 * Cap gains stack on top of ordinary taxable income.
 */
export function calcCapGainsTax(
  ltCapGains: number,
  ordinaryBase: number,
  brackets: CapGainsTier
): number {
  if (ltCapGains <= 0) return 0;

  const stackBottom = Math.max(0, ordinaryBase);
  const stackTop = stackBottom + ltCapGains;

  let tax = 0;
  if (stackTop > brackets.zeroPctTop) {
    const fifteenStart = Math.max(stackBottom, brackets.zeroPctTop);
    const fifteenEnd = Math.min(stackTop, brackets.fifteenPctTop);
    if (fifteenEnd > fifteenStart) tax += (fifteenEnd - fifteenStart) * 0.15;
  }
  if (stackTop > brackets.fifteenPctTop) {
    const twentyStart = Math.max(stackBottom, brackets.fifteenPctTop);
    tax += (stackTop - twentyStart) * 0.20;
  }
  return tax;
}
