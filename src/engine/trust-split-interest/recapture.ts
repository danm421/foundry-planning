export interface RecaptureInput {
  originalIncomeInterest: number;
  irc7520Rate: number;
  /** Actual unitrust payments made, indexed by years-since-inception (t=1 first). */
  paymentsByYearOffset: number[];
}

export interface RecaptureResult {
  /** Ordinary income on grantor's final 1040. May be negative — caller clamps to >= 0. */
  recaptureAmount: number;
  /** PV (at the original §7520 rate) of payments actually made through grantor's death. */
  pvOfPaymentsMade: number;
}

/**
 * §170(f)(2)(B) recapture for a grantor CLT when the grantor dies before the
 * lead term ends:
 *
 *   recapture = originalIncomeInterest − Σ payments_t × (1 + r)^(-t)
 *
 * Negative results aren't clamped here — the caller decides whether to record
 * a negative (which means the actual lead-PV exceeded the original deduction,
 * an artifact of generous projections) or floor it at zero per IRS practice.
 */
export function computeClutRecapture(input: RecaptureInput): RecaptureResult {
  const { originalIncomeInterest, irc7520Rate, paymentsByYearOffset } = input;
  let pv = 0;
  for (let i = 0; i < paymentsByYearOffset.length; i++) {
    const t = i + 1;
    pv += paymentsByYearOffset[i] / Math.pow(1 + irc7520Rate, t);
  }
  return {
    recaptureAmount: originalIncomeInterest - pv,
    pvOfPaymentsMade: pv,
  };
}
