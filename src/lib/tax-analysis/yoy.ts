import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

export interface YoYRow {
  label: string;
  kind: "money" | "rate";
  current: number | null;
  prior: number | null;
  delta: number | null;
}

function row(label: string, kind: YoYRow["kind"], current: number | null, prior: number | null): YoYRow {
  return {
    label, kind, current, prior,
    delta: current != null && prior != null ? current - prior : null,
  };
}

function effRate(f: TaxReturnFacts): number | null {
  if (f.tax.totalTax == null || f.income.agi == null || f.income.agi === 0) return null;
  return f.tax.totalTax / f.income.agi;
}

export function buildYoY(current: TaxReturnFacts, prior: TaxReturnFacts): YoYRow[] {
  return [
    row("Total income", "money", current.income.totalIncome, prior.income.totalIncome),
    row("Adjusted gross income", "money", current.income.agi, prior.income.agi),
    row("Taxable income", "money", current.deductions.taxableIncome, prior.deductions.taxableIncome),
    row("Total tax", "money", current.tax.totalTax, prior.tax.totalTax),
    row("Effective federal rate", "rate", effRate(current), effRate(prior)),
    row("Withholding", "money", current.payments.withholding, prior.payments.withholding),
  ];
}
