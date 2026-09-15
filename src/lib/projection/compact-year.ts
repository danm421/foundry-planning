import type { ProjectionYear } from "@/engine/types";

export type CompactProjectionYear = {
  year: number;
  ages: ProjectionYear["ages"];
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  totalTax: number | null;
  medicareTotal: number | null;
  irmaaSurcharge: number | null;
  portfolioAssets: ProjectionYear["portfolioAssets"];
};

/** Per-year story compacted for the model — the engine's own numbers only. */
export function compactYear(y: ProjectionYear): CompactProjectionYear {
  return {
    year: y.year,
    ages: y.ages,
    totalIncome: y.income.total,
    totalExpenses: y.expenses.total,
    netCashFlow: y.netCashFlow,
    totalTax: y.taxResult?.flow.totalTax ?? null,
    medicareTotal: y.medicare?.totalAnnualCost ?? null,
    irmaaSurcharge: y.medicare?.totalIrmaaSurcharge ?? null,
    portfolioAssets: y.portfolioAssets,
  };
}
