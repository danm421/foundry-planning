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
