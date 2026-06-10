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

/** Schedule SE multiplier — net SE earnings × 92.35% backs out the
 *  self-employed half-share before applying Medicare rates. Shared by
 *  calcSeca and calcSeAdditionalMedicare so the SE base matches exactly. */
const SE_NET_MULTIPLIER = 0.9235;

export interface SeAdditionalMedicareInput {
  /** Net earnings from self-employment (same input as calcSeca.seEarnings). */
  seEarnings: number;
  /** W-2 wages already subject to FICA Medicare this year. Per IRC
   *  §1401(b)(2), wages consume the filing-status threshold dollar-for-dollar
   *  before the SE base is tested against it. */
  ficaSsWages: number;
  threshold: number;
  rate: number;
}

/**
 * SE-side 0.9% Additional Medicare surtax (IRC §1401(b)(2)).
 *
 * The 0.9% surtax applies to combined wages + SE income above the
 * filing-status threshold. Wages are taxed on the wage side
 * (calcAdditionalMedicare); here we tax the SE base, but the threshold has
 * already been (partially) consumed by wages — so we only reduce the SE base
 * by the *remaining* threshold (threshold − wages, floored at 0). This applies
 * the threshold exactly once across both wage- and SE-sides (no double-count).
 *
 *   surtax_SE = rate × max(0, 0.9235·seEarnings − max(0, threshold − wages))
 */
export function calcSeAdditionalMedicare(input: SeAdditionalMedicareInput): number {
  if (input.seEarnings <= 0) return 0;
  const netSeForTax = input.seEarnings * SE_NET_MULTIPLIER;
  const remainingThreshold = Math.max(0, input.threshold - input.ficaSsWages);
  const surtaxBase = Math.max(0, netSeForTax - remainingThreshold);
  return surtaxBase * input.rate;
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
  const netSeForTax = input.seEarnings * SE_NET_MULTIPLIER;
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
