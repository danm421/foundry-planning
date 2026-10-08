// src/lib/schemas/__tests__/ss-stated-age-validation.test.ts
import { describe, it, expect } from "vitest";
import { incomeCreateSchema, incomeUpdateSchema } from "@/lib/schemas/incomes";

const base = { type: "social_security", name: "SS", startYear: 2026, endYear: 2099 };

describe("Social Security stated age + unit", () => {
  it("accepts a stated age of 62-70 with months, and a unit", () => {
    const r = incomeCreateSchema.parse({ ...base, ssStatedAge: 70, ssStatedAgeMonths: 0, ssAmountUnit: "monthly" });
    expect(r.ssStatedAge).toBe(70);
    expect(r.ssStatedAgeMonths).toBe(0);
    expect(r.ssAmountUnit).toBe("monthly");
  });

  it("coerces string ages from form posts", () => {
    const r = incomeUpdateSchema.parse({ ssStatedAge: "68", ssStatedAgeMonths: "6" });
    expect(r.ssStatedAge).toBe(68);
    expect(r.ssStatedAgeMonths).toBe(6);
  });

  it("rejects ages outside 62-70 instead of clamping", () => {
    expect(() => incomeUpdateSchema.parse({ ssStatedAge: 75 })).toThrow();
    expect(() => incomeUpdateSchema.parse({ ssStatedAge: 61 })).toThrow();
    expect(() => incomeUpdateSchema.parse({ ssStatedAgeMonths: 12 })).toThrow();
  });

  it("rejects an unknown unit", () => {
    expect(() => incomeUpdateSchema.parse({ ssAmountUnit: "weekly" })).toThrow();
  });

  it("null clears (row follows its claim age); absent stays absent on update", () => {
    expect(incomeUpdateSchema.parse({ ssStatedAge: null }).ssStatedAge).toBeNull();
    expect(incomeUpdateSchema.parse({}).ssStatedAge).toBeUndefined();
    expect(incomeUpdateSchema.parse({}).ssAmountUnit).toBeUndefined();
  });
});
