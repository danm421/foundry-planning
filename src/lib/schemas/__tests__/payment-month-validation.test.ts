import { describe, it, expect } from "vitest";
import { incomeCreateSchema, incomeUpdateSchema } from "@/lib/schemas/incomes";
import { expenseCreateSchema } from "@/lib/schemas/expenses";

const baseIncome = { type: "salary", name: "Salary", startYear: 2026, endYear: 2040 };
const baseExpense = { type: "living", name: "Living", startYear: 2026, endYear: 2040 };

describe("paymentMonth validation", () => {
  it("accepts 1 through 12", () => {
    for (const m of [1, 6, 12]) {
      const r = incomeCreateSchema.safeParse({ ...baseIncome, paymentMonth: m });
      expect(r.success, `month ${m} should be valid`).toBe(true);
      if (r.success) expect(r.data.paymentMonth).toBe(m);
    }
  });

  it("accepts null and treats an omitted field as null on create", () => {
    const withNull = incomeCreateSchema.safeParse({ ...baseIncome, paymentMonth: null });
    expect(withNull.success).toBe(true);

    const omitted = incomeCreateSchema.safeParse(baseIncome);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.paymentMonth ?? null).toBeNull();
  });

  // Rejected, never clamped. A silently clamped 13 would put a December row
  // in January and the advisor would never be told.
  it("rejects out-of-range and non-integer months", () => {
    for (const bad of [0, 13, -1, 6.5]) {
      const r = incomeCreateSchema.safeParse({ ...baseIncome, paymentMonth: bad });
      expect(r.success, `month ${bad} should be rejected`).toBe(false);
    }
  });

  it("leaves an omitted field absent on update rather than nulling it", () => {
    const r = incomeUpdateSchema.safeParse({ name: "Renamed" });
    expect(r.success).toBe(true);
    if (r.success) expect("paymentMonth" in r.data && r.data.paymentMonth !== undefined).toBe(false);
  });

  it("applies the same rules to expenses", () => {
    expect(expenseCreateSchema.safeParse({ ...baseExpense, paymentMonth: 11 }).success).toBe(true);
    expect(expenseCreateSchema.safeParse({ ...baseExpense, paymentMonth: 13 }).success).toBe(false);
  });
});
