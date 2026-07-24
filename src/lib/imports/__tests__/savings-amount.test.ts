import { describe, expect, it } from "vitest";
import { parseSavingsAmount } from "../savings-amount";

describe("parseSavingsAmount", () => {
  it("parses a percent-of-salary deferral", () => {
    expect(parseSavingsAmount("10.0% of salary")).toEqual({ annualPercent: 0.1 });
  });

  it("parses a flat annual dollar amount", () => {
    expect(parseSavingsAmount("$12,000 per year")).toEqual({ annualAmount: 12000 });
  });

  it("parses a tiered match", () => {
    expect(
      parseSavingsAmount("50.0% of the first 6.0% of employee's salary contributed"),
    ).toEqual({ employerMatchPct: 0.5, employerMatchCap: 0.06 });
  });

  it("parses a whole-number percent", () => {
    expect(parseSavingsAmount("7% of salary")).toEqual({ annualPercent: 0.07 });
  });

  it("returns null for text it does not recognise", () => {
    expect(parseSavingsAmount("Spend 100%")).toBeNull();
    expect(parseSavingsAmount("")).toBeNull();
  });

  it("prefers the tiered form over the bare percent when both could match", () => {
    const parsed = parseSavingsAmount("50.0% of the first 6.0% of salary");
    expect(parsed).toEqual({ employerMatchPct: 0.5, employerMatchCap: 0.06 });
    expect(parsed).not.toHaveProperty("annualPercent");
  });

  it("returns null when a cell contains both percent and dollar amount", () => {
    expect(parseSavingsAmount("$3,000 per year (approximately 5% of salary)")).toBeNull();
    expect(parseSavingsAmount("6% of salary or $3,000 per year, whichever is greater")).toBeNull();
  });

  it("still parses tiered match with dollar cap as tiered", () => {
    const parsed = parseSavingsAmount("50.0% of the first 6.0% of salary, up to $5,000 per year");
    expect(parsed).toEqual({ employerMatchPct: 0.5, employerMatchCap: 0.06 });
    expect(parsed).not.toHaveProperty("annualAmount");
  });
});
