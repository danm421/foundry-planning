import { describe, it, expect } from "vitest";
import { validateMarginFields } from "../margin-validation";

const ok = { category: "taxable", value: 10_000_000, marginBalance: 2_000_000, marginInterestRate: 0.02, marginCallPct: 0.3 };

describe("validateMarginFields", () => {
  it("accepts a valid margined taxable account", () => {
    expect(validateMarginFields(ok)).toBeNull();
  });
  it("accepts a non-taxable account with no loan", () => {
    expect(validateMarginFields({ ...ok, category: "retirement", marginBalance: 0 })).toBeNull();
  });
  it("rejects a loan on a non-taxable account", () => {
    expect(validateMarginFields({ ...ok, category: "cash" })).toMatch(/Remove the margin loan before changing the account type/);
  });
  it("rejects a loan at or above value", () => {
    expect(validateMarginFields({ ...ok, marginBalance: 10_000_000 })).toMatch(/less than the account's value/);
  });
  it("rejects a negative loan", () => {
    expect(validateMarginFields({ ...ok, marginBalance: -1 })).toMatch(/can't be negative/);
  });
  it("rejects a rate above 25%", () => {
    expect(validateMarginFields({ ...ok, marginInterestRate: 0.26 })).toMatch(/between 0% and 25%/);
  });
  it("rejects a margin call level of 0 or 1", () => {
    expect(validateMarginFields({ ...ok, marginCallPct: 0 })).toMatch(/between 0% and 100%/);
    expect(validateMarginFields({ ...ok, marginCallPct: 1 })).toMatch(/between 0% and 100%/);
  });
});
