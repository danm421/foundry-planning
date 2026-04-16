/**
 * Flat state income tax (MVP — bracket-based state tax is deferred).
 * Applied to total taxable income, matching the existing engine's behavior.
 */
export function calcStateTax(taxableIncome: number, flatStateRate: number): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * flatStateRate;
}
