import { money, yearWithRef, label } from "../labels";
import { DESCRIBERS, simpleDescriber } from "../registry";

const num = (v: unknown) => (typeof v === "string" ? Number(v) : (v as number));

const window = (p: Record<string, unknown>): string | null => {
  const start = num(p.startYear);
  if (!Number.isFinite(start)) return null;
  const startStr = yearWithRef(start, p.startYearRef as string);
  const end = num(p.endYear);
  return `${startStr}–${Number.isFinite(end) ? end : "end"}`;
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
    (p) => (Number.isFinite(num(p.interestRate)) && num(p.interestRate) ? `${(num(p.interestRate) * 100).toFixed(2)}%` : null),
    (p) => (p.monthlyPayment != null ? `${money(p.monthlyPayment)}/mo` : null),
  ],
});

DESCRIBERS.extra_payment = simpleDescriber({
  area: "Liabilities", noun: "extra payment", whatMode: "name",
  segments: [
    (p) => (p.amount != null ? money(p.amount) : null),
    (p) => (Number.isFinite(num(p.year)) && num(p.year) ? String(num(p.year)) : null),
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
