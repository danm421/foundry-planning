import type { PlanSettings } from "./types";

export function calculateTaxes(
  taxableIncome: number,
  settings: PlanSettings
): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * (settings.flatFederalRate + settings.flatStateRate);
}
