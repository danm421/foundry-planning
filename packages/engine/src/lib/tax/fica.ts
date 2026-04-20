export interface FicaInput {
  earnedIncome: number;
  ssTaxRate: number;
  ssWageBase: number;
  medicareTaxRate: number;
}

export interface FicaResult {
  ssTax: number;
  medicareTax: number;
  total: number;
}

/**
 * FICA = Social Security + Medicare. SS capped at wage base; Medicare uncapped.
 * Does NOT include Additional Medicare (use calcAdditionalMedicare).
 */
export function calcFica(input: FicaInput): FicaResult {
  if (input.earnedIncome <= 0) return { ssTax: 0, medicareTax: 0, total: 0 };
  const ssBase = Math.min(input.earnedIncome, input.ssWageBase);
  const ssTax = ssBase * input.ssTaxRate;
  const medicareTax = input.earnedIncome * input.medicareTaxRate;
  return { ssTax, medicareTax, total: ssTax + medicareTax };
}

export interface AdditionalMedicareInput {
  earnedIncome: number;
  threshold: number;
  rate: number;
}

/**
 * Additional Medicare: 0.9% on earned income above filing-status threshold.
 * Thresholds statutorily fixed: $250k MFJ, $200k single/HoH, $125k MFS.
 */
export function calcAdditionalMedicare(input: AdditionalMedicareInput): number {
  return Math.max(0, input.earnedIncome - input.threshold) * input.rate;
}

export interface SecaInput {
  /** Net earnings from self-employment (Schedule C, partnership K-1
   *  self-employment earnings, etc.). Pre-SE-tax, pre any deduction. */
  seEarnings: number;
  ssTaxRate: number;      // employee-side SS rate; engine doubles it for SECA
  ssWageBase: number;
  medicareTaxRate: number; // employee-side Medicare rate; engine doubles for SECA
  /** Wages subject to FICA SS this year (to coordinate the SS wage-base
   *  cap across W-2 + SE earnings — SS only taxes the first `ssWageBase`
   *  dollars across both employment types). */
  ficaSsWages?: number;
}

export interface SecaResult {
  /** Full 15.3%-equivalent SECA tax (both halves). Schedule SE total. */
  seTax: number;
  /** Half-SE-tax adjustment deductible above the line. */
  deductibleHalf: number;
}

/**
 * Self-Employment Contributions Act (SECA) tax. Self-employed individuals
 * pay both the employer and employee share of FICA — 15.3% total (12.4% SS +
 * 2.9% Medicare) on 92.35% of net SE earnings, with the SS portion capped
 * at the wage base (coordinated with W-2 SS wages), and a deduction for
 * one-half of the SE tax as an above-line adjustment.
 *
 * References: IRC §1401, §164(f), Schedule SE.
 */
export function calcSeca(input: SecaInput): SecaResult {
  if (input.seEarnings <= 0) return { seTax: 0, deductibleHalf: 0 };
  // Schedule SE multiplier: net SE earnings × 92.35% to back out the
  // self-employed half-share before applying full rates.
  const netSeForTax = input.seEarnings * 0.9235;
  // SS portion capped at wage base, reduced by any W-2 SS wages already
  // subject to FICA this year (the wage-base cap is shared across both).
  const remainingSsCap = Math.max(0, input.ssWageBase - (input.ficaSsWages ?? 0));
  const ssSeBase = Math.min(netSeForTax, remainingSsCap);
  // Full 12.4%/2.9% rates (both halves).
  const ssSeTax = ssSeBase * (input.ssTaxRate * 2);
  const medicareSeTax = netSeForTax * (input.medicareTaxRate * 2);
  const seTax = ssSeTax + medicareSeTax;
  return { seTax, deductibleHalf: seTax / 2 };
}
