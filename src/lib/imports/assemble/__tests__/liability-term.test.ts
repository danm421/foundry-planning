import { describe, expect, it } from "vitest";
import { deriveLiabilityTerm } from "../liability-term";

const TODAY = new Date(Date.UTC(2026, 8, 17)); // 2026-09-17

describe("deriveLiabilityTerm", () => {
  it("uses the as-of date as the start and counts whole months to maturity", () => {
    const { term, warning } = deriveLiabilityTerm(
      { balanceAsOfDate: "2026-08-31", maturityDate: "2041-08-01" },
      TODAY,
    );
    expect(term.startYear).toBe(2026);
    expect(term.startMonth).toBe(8);
    expect(term.balanceAsOfYear).toBe(2026);
    expect(term.balanceAsOfMonth).toBe(8);
    // Aug 2026 -> Aug 2041 = 15 years.
    expect(term.termMonths).toBe(180);
    expect(warning).toBeUndefined();
  });

  it("falls back to a 30-year term and warns when no maturity is printed", () => {
    const { term, warning } = deriveLiabilityTerm({ balanceAsOfDate: "2026-08-31" }, TODAY);
    expect(term.startYear).toBe(2026);
    expect(term.startMonth).toBe(8);
    expect(term.termMonths).toBe(360);
    expect(warning).toMatch(/no maturity date/i);
  });

  it("falls back to today when no as-of date is printed", () => {
    const { term } = deriveLiabilityTerm({ maturityDate: "2041-08-01" }, TODAY);
    expect(term.startYear).toBe(2026);
    expect(term.startMonth).toBe(9);
    // The balance was never dated, so the as-of columns stay empty rather
    // than claiming today's date is what the statement said.
    expect(term.balanceAsOfYear).toBeNull();
    expect(term.balanceAsOfMonth).toBeNull();
    expect(term.termMonths).toBe(179);
  });

  it("refuses a maturity that precedes the as-of date and warns", () => {
    const { term, warning } = deriveLiabilityTerm(
      { balanceAsOfDate: "2026-08-31", maturityDate: "2019-01-01" },
      TODAY,
    );
    expect(term.termMonths).toBe(360);
    expect(warning).toMatch(/matures before/i);
  });

  it("refuses an unparseable date rather than producing NaN", () => {
    const { term, warning } = deriveLiabilityTerm(
      { balanceAsOfDate: "Q3 2026", maturityDate: "2041-08-01" },
      TODAY,
    );
    expect(term.startYear).toBe(2026);
    expect(term.startMonth).toBe(9);
    expect(Number.isInteger(term.termMonths)).toBe(true);
    expect(warning).toBeUndefined();
  });

  it("never returns a term of zero or less", () => {
    const { term } = deriveLiabilityTerm(
      { balanceAsOfDate: "2026-08-01", maturityDate: "2026-08-01" },
      TODAY,
    );
    expect(term.termMonths).toBeGreaterThan(0);
  });
});
