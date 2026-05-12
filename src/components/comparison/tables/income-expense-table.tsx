"use client";

import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const COLUMNS: Array<{
  label: string;
  value: (y: ProjectionYear) => number;
  sign: 1 | -1;
}> = [
  { label: "Salaries", value: (y) => y.income.salaries, sign: 1 },
  { label: "Social Security", value: (y) => y.income.socialSecurity, sign: 1 },
  { label: "Business", value: (y) => y.income.business, sign: 1 },
  { label: "Trust", value: (y) => y.income.trust, sign: 1 },
  { label: "Deferred", value: (y) => y.income.deferred, sign: 1 },
  { label: "Capital Gains", value: (y) => y.income.capitalGains, sign: 1 },
  { label: "Other Income", value: (y) => y.income.other, sign: 1 },
  { label: "Living", value: (y) => y.expenses.living, sign: -1 },
  { label: "Real Estate Exp", value: (y) => y.expenses.realEstate, sign: -1 },
  { label: "Insurance", value: (y) => y.expenses.insurance, sign: -1 },
  { label: "Taxes", value: (y) => y.expenses.taxes, sign: -1 },
  { label: "Debt service", value: (y) => y.expenses.liabilities, sign: -1 },
  { label: "Other Expenses", value: (y) => y.expenses.other, sign: -1 },
];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

export function IncomeExpenseTable({
  plan,
  yearRange,
}: {
  plan: ComparisonPlan;
  yearRange: YearRange | null;
}) {
  const years = clip(plan.result.years, yearRange);
  return (
    <div className="overflow-auto">
      <table
        aria-label={`Income & Expense — ${plan.label}`}
        className="min-w-full border-collapse text-xs"
      >
        <thead>
          <tr className="bg-slate-900/60 text-slate-300">
            <th className="px-2 py-1 text-left">Year</th>
            {COLUMNS.map((c) => (
              <th key={c.label} className="px-2 py-1 text-right">
                {c.label}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            let net = 0;
            return (
              <tr key={y.year} className="border-t border-slate-800 text-slate-200">
                <td className="px-2 py-1">{y.year}</td>
                {COLUMNS.map((c) => {
                  const v = c.value(y) * c.sign;
                  net += v;
                  return (
                    <td
                      key={c.label}
                      className="px-2 py-1 text-right tabular-nums"
                    >
                      {usd.format(v)}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right tabular-nums font-medium">
                  {usd.format(net)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function IncomeExpenseTableList({
  plans,
  yearRange,
}: {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {plans.map((plan) => (
        <div key={plan.id}>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            {plan.label}
          </div>
          <IncomeExpenseTable plan={plan} yearRange={yearRange} />
        </div>
      ))}
    </div>
  );
}
