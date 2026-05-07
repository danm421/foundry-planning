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
