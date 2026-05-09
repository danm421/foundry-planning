import type { ProjectionYear } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

export function computeEndingNetWorth(years: ProjectionYear[]): number {
  if (years.length === 0) return 0;
  return years[years.length - 1]?.portfolioAssets?.total ?? 0;
}

export function computeYearsPortfolioSurvives(years: ProjectionYear[]): number {
  let count = 0;
  for (const y of years) {
    if ((y.portfolioAssets?.total ?? 0) > 0) count++;
    else break;
  }
  return count;
}

export interface EstateTotals {
  totalEstateTax: number;
  totalAdminExpenses: number;
}

export function computeEstateTotals(result: ProjectionResult): EstateTotals {
  const tax = (e?: { federalEstateTax?: number; stateEstateTax?: number }) =>
    (e?.federalEstateTax ?? 0) + (e?.stateEstateTax ?? 0);
  const admin = (e?: { estateAdminExpenses?: number }) => e?.estateAdminExpenses ?? 0;
  return {
    totalEstateTax: tax(result.firstDeathEvent) + tax(result.secondDeathEvent),
    totalAdminExpenses: admin(result.firstDeathEvent) + admin(result.secondDeathEvent),
  };
}
