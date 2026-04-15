import type { Liability } from "./types";

interface AmortizationResult {
  annualPayment: number;
  interestPortion: number;
  principalPortion: number;
  endingBalance: number;
}

interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
}

export function amortizeLiability(
  liability: Liability,
  year: number
): AmortizationResult {
  if (year < liability.startYear || year > liability.endYear || liability.balance <= 0) {
    return { annualPayment: 0, interestPortion: 0, principalPortion: 0, endingBalance: 0 };
  }

  const interest = liability.balance * liability.interestRate;
  const scheduledPayment = liability.monthlyPayment * 12;
  const totalOwed = liability.balance + interest;

  const annualPayment = Math.min(scheduledPayment, totalOwed);
  const interestPortion = Math.min(interest, annualPayment);
  const principalPortion = annualPayment - interestPortion;
  const endingBalance = Math.max(0, liability.balance - principalPortion);

  return { annualPayment, interestPortion, principalPortion, endingBalance };
}

export function computeLiabilities(
  liabilities: Liability[],
  year: number,
  filter?: (liab: Liability) => boolean
): LiabilitiesResult {
  let totalPayment = 0;
  const updatedLiabilities: Liability[] = [];
  const byLiability: Record<string, number> = {};

  for (const liab of liabilities) {
    const result = amortizeLiability(liab, year);
    // Preserve the balance roll-forward even when the liability is filtered out
    // (e.g. entity-owned) so the stored state stays consistent across years.
    updatedLiabilities.push({ ...liab, balance: result.endingBalance });
    byLiability[liab.id] = result.annualPayment;
    if (filter && !filter(liab)) continue;
    totalPayment += result.annualPayment;
  }

  return { totalPayment, updatedLiabilities, byLiability };
}
