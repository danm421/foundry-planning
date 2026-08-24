import type { CapGainsTier } from "./types";
import { STATUTORY_MID_RATE, STATUTORY_TOP_RATE } from "./rate-stress";

/**
 * Calculate LT capital gains tax (and qualified dividends, treated identically).
 * Cap gains stack on top of ordinary taxable income.
 *
 * The 15%/20% rates come off the tier rather than being literals here, so the
 * "tax rates rise" stressor can raise them by writing the params the resolver
 * hands down. A tier with no override behaves exactly as before.
 */
export function calcCapGainsTax(
  ltCapGains: number,
  ordinaryBase: number,
  brackets: CapGainsTier
): number {
  if (ltCapGains <= 0) return 0;

  const midRate = brackets.midRate ?? STATUTORY_MID_RATE;
  const topRate = brackets.topRate ?? STATUTORY_TOP_RATE;

  const stackBottom = Math.max(0, ordinaryBase);
  const stackTop = stackBottom + ltCapGains;

  let tax = 0;
  if (stackTop > brackets.zeroPctTop) {
    const fifteenStart = Math.max(stackBottom, brackets.zeroPctTop);
    const fifteenEnd = Math.min(stackTop, brackets.fifteenPctTop);
    if (fifteenEnd > fifteenStart) tax += (fifteenEnd - fifteenStart) * midRate;
  }
  if (stackTop > brackets.fifteenPctTop) {
    const twentyStart = Math.max(stackBottom, brackets.fifteenPctTop);
    tax += (stackTop - twentyStart) * topRate;
  }
  return tax;
}
