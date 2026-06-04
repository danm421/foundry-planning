import type { ClientData } from "@/engine";

/**
 * Returns the total annual income active at the given plan start year.
 * Pure function — safe to call from both lib and client components.
 */
export function annualIncomeAtStart(clientData: ClientData, planStartYear: number): number {
  const incomes = (clientData.incomes ?? []) as Array<{
    annualAmount: number | string;
    startYear?: number | null;
    endYear?: number | null;
  }>;
  let total = 0;
  for (const inc of incomes) {
    const starts = inc.startYear ?? -Infinity;
    const ends = inc.endYear ?? Infinity;
    if (planStartYear >= starts && planStartYear <= ends) {
      const amt = typeof inc.annualAmount === "string" ? parseFloat(inc.annualAmount) : inc.annualAmount;
      if (Number.isFinite(amt)) total += amt;
    }
  }
  return total;
}
