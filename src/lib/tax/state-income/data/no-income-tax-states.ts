// src/lib/tax/state-income/data/no-income-tax-states.ts
import type { USPSStateCode } from "@/lib/usps-states";

export const NO_INCOME_TAX_STATES: readonly USPSStateCode[] = [
  "AK", "FL", "NV", "NH", "SD", "TN", "TX", "WY",
] as const;

export function isNoIncomeTaxState(s: USPSStateCode): boolean {
  return (NO_INCOME_TAX_STATES as readonly USPSStateCode[]).includes(s);
}
