import type { Liability } from "./types";

export interface AmortizationResult {
  annualPayment: number;
  interestPortion: number;
  principalPortion: number;
  endingBalance: number;
}

interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
  interestByLiability: Record<string, number>;
}

export function amortizeLiability(
  liability: Liability,
  year: number
): AmortizationResult {
  const endYear =
    liability.startYear + Math.ceil(liability.termMonths / 12) - 1;

  if (
    year < liability.startYear ||
    year > endYear ||
    liability.balance <= 0
  ) {
    return {
      annualPayment: 0,
      interestPortion: 0,
      principalPortion: 0,
      endingBalance: 0,
    };
  }

  const interest = liability.balance * liability.interestRate;
  const scheduledPayment = liability.monthlyPayment * 12;
  const totalOwed = liability.balance + interest;
  const annualPayment = Math.min(scheduledPayment, totalOwed);
  const interestPortion = Math.min(interest, annualPayment);
  const principalFromPayment = annualPayment - interestPortion;

  // Extra payments for this year
  const extras = (liability.extraPayments ?? []).filter(
    (ep) => ep.year === year
  );
  const perPaymentExtra = extras
    .filter((ep) => ep.type === "per_payment")
    .reduce((sum, ep) => sum + ep.amount * 12, 0);
  const lumpSumExtra = extras
    .filter((ep) => ep.type === "lump_sum")
    .reduce((sum, ep) => sum + ep.amount, 0);

  const totalExtra = perPaymentExtra + lumpSumExtra;
  const totalPrincipal = Math.min(
    principalFromPayment + totalExtra,
    liability.balance
  );
  const endingBalance = Math.max(0, liability.balance - totalPrincipal);

  return {
    annualPayment: annualPayment + Math.min(totalExtra, liability.balance - principalFromPayment),
    interestPortion,
    principalPortion: totalPrincipal,
    endingBalance,
  };
}

export function computeLiabilities(
  liabilities: Liability[],
  year: number,
  filter?: (liab: Liability) => boolean
): LiabilitiesResult {
  let totalPayment = 0;
  const updatedLiabilities: Liability[] = [];
  const byLiability: Record<string, number> = {};
  const interestByLiability: Record<string, number> = {};

  for (const liab of liabilities) {
    const result = amortizeLiability(liab, year);
    // Preserve the balance roll-forward even when the liability is filtered out
    // (e.g. entity-owned) so the stored state stays consistent across years.
    updatedLiabilities.push({ ...liab, balance: result.endingBalance });
    byLiability[liab.id] = result.annualPayment;
    interestByLiability[liab.id] = result.interestPortion;
    if (filter && !filter(liab)) continue;
    totalPayment += result.annualPayment;
  }

  return { totalPayment, updatedLiabilities, byLiability, interestByLiability };
}
