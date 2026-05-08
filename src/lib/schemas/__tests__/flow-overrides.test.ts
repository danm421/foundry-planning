import { describe, it, expect } from "vitest";
import { flowOverrideRowSchema, flowOverrideBulkSchema } from "../flow-overrides";

describe("flowOverrideRowSchema", () => {
  it("accepts a row with only year (sparse)", () => {
    const r = flowOverrideRowSchema.safeParse({ year: 2026 });
    expect(r.success).toBe(true);
  });

  it("accepts all three amount fields filled", () => {
    const r = flowOverrideRowSchema.safeParse({
      year: 2026,
      incomeAmount: 100_000,
      expenseAmount: 30_000,
      distributionPercent: 0.5,
    });
    expect(r.success).toBe(true);
  });

  it("accepts null for any amount field", () => {
    const r = flowOverrideRowSchema.safeParse({
      year: 2026,
      incomeAmount: null,
      expenseAmount: null,
      distributionPercent: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects distributionPercent > 1", () => {
    const r = flowOverrideRowSchema.safeParse({ year: 2026, distributionPercent: 1.5 });
    expect(r.success).toBe(false);
  });

  it("rejects distributionPercent < 0", () => {
    const r = flowOverrideRowSchema.safeParse({ year: 2026, distributionPercent: -0.1 });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer year", () => {
    const r = flowOverrideRowSchema.safeParse({ year: 2026.5 });
    expect(r.success).toBe(false);
  });
});

describe("flowOverrideBulkSchema", () => {
  it("accepts an empty overrides array (clears all)", () => {
    const r = flowOverrideBulkSchema.safeParse({ overrides: [] });
    expect(r.success).toBe(true);
  });

  it("accepts unique years", () => {
    const r = flowOverrideBulkSchema.safeParse({
      overrides: [
        { year: 2026, incomeAmount: 100_000 },
        { year: 2027, incomeAmount: 110_000 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate years", () => {
    const r = flowOverrideBulkSchema.safeParse({
      overrides: [
        { year: 2026, incomeAmount: 100_000 },
        { year: 2026, incomeAmount: 200_000 },
      ],
    });
    expect(r.success).toBe(false);
  });
});
