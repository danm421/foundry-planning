import { money, yearWithRef, label, toNum } from "../labels";
import { DESCRIBERS, simpleDescriber } from "../registry";

const window = (p: Record<string, unknown>): string | null => {
  const start = toNum(p.startYear);
  if (start == null) return null;
  const startStr = yearWithRef(start, p.startYearRef as string);
  const end = toNum(p.endYear);
  return `${startStr}–${end != null ? end : "end"}`;
};

DESCRIBERS.income = simpleDescriber({
  area: "Income", noun: "income source", whatMode: "name",
  segments: [
    (p) => label("incomeType", p.type),
    (p) => (p.annualAmount != null ? `${money(p.annualAmount)}/yr` : null),
    (p) => (typeof p.owner === "string" ? label("grantor", p.owner) : null),
    (p) => window(p),
  ],
});

DESCRIBERS.expense = simpleDescriber({
  area: "Expenses", noun: "expense", whatMode: "name",
  segments: [
    (p) => label("expenseType", p.type),
    (p) => (p.annualAmount != null ? `${money(p.annualAmount)}/yr` : null),
    (p) => window(p),
  ],
});

DESCRIBERS.liability = simpleDescriber({
  area: "Liabilities", noun: "liability", whatMode: "name",
  segments: [
    (p) => (p.balance != null ? money(p.balance) : null),
    (p) => { const r = toNum(p.interestRate); return r ? `${(r * 100).toFixed(2)}%` : null; },
    (p) => (p.monthlyPayment != null ? `${money(p.monthlyPayment)}/mo` : null),
  ],
});

DESCRIBERS.extra_payment = simpleDescriber({
  area: "Liabilities", noun: "extra payment", whatMode: "name",
  segments: [
    (p) => (p.amount != null ? money(p.amount) : null),
    (p) => { const y = toNum(p.year); return y ? String(y) : null; },
  ],
});

DESCRIBERS.expense_schedule_override = simpleDescriber({
  area: "Expenses", noun: "expense schedule", whatMode: "name",
  segments: [() => "Custom year-by-year amounts"],
});

DESCRIBERS.income_schedule_override = simpleDescriber({
  area: "Income", noun: "income schedule", whatMode: "name",
  segments: [() => "Custom year-by-year amounts"],
});
