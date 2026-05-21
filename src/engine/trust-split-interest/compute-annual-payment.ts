export interface AnnualPaymentInput {
  payoutPercent: number;
  startOfYearFmv: number;
}

export interface AnnualPaymentResult {
  unitrustAmount: number;
}

export function computeAnnualUnitrustPayment(
  input: AnnualPaymentInput,
): AnnualPaymentResult {
  const { payoutPercent, startOfYearFmv } = input;
  if (payoutPercent < 0 || payoutPercent > 1) {
    throw new Error(`payoutPercent out of [0,1]: ${payoutPercent}`);
  }
  if (startOfYearFmv <= 0) {
    return { unitrustAmount: 0 };
  }
  return { unitrustAmount: payoutPercent * startOfYearFmv };
}

export interface AnnuityPaymentInput {
  payoutAmount: number;
}

export interface AnnuityPaymentResult {
  annuityAmount: number;
}

/**
 * CLAT annual payment — fixed dollar amount, independent of trust FMV.
 *
 * Returns the payoutAmount as-is. Kept as a typed helper for symmetry with
 * computeAnnualUnitrustPayment and to give us a place to hang future edge-case
 * handling (e.g. balance-capped underpayment).
 */
export function computeAnnualAnnuityPayment(
  input: AnnuityPaymentInput,
): AnnuityPaymentResult {
  const { payoutAmount } = input;
  if (payoutAmount < 0) {
    throw new Error(`payoutAmount must be non-negative: ${payoutAmount}`);
  }
  return { annuityAmount: payoutAmount };
}
