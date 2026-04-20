export interface QbiInput {
  qbi: number;
  taxableIncomeBeforeQbi: number;
  ltCapGainsAndQualDiv: number;
  threshold: number;
  phaseInRange: number;
}

/**
 * Section 199A QBI deduction (v1 simplified — no SSTB distinction, no W-2 cap).
 *
 * - Below threshold: full 20% × QBI
 * - Within phase-in range: linearly reduced
 * - Above (threshold + phase-in): 0
 *
 * Cap: deduction ≤ 20% × (taxable income before QBI - LT cap gains - qual div).
 */
export function calcQbiDeduction(input: QbiInput): number {
  if (input.qbi <= 0) return 0;

  const fullDeduction = input.qbi * 0.20;
  const cap = Math.max(0, (input.taxableIncomeBeforeQbi - input.ltCapGainsAndQualDiv) * 0.20);

  let allowed: number;
  if (input.taxableIncomeBeforeQbi <= input.threshold) {
    allowed = fullDeduction;
  } else if (input.taxableIncomeBeforeQbi >= input.threshold + input.phaseInRange) {
    allowed = 0;
  } else {
    const intoRange = input.taxableIncomeBeforeQbi - input.threshold;
    const phaseOutFraction = intoRange / input.phaseInRange;
    allowed = fullDeduction * (1 - phaseOutFraction);
  }

  return Math.min(allowed, cap);
}
