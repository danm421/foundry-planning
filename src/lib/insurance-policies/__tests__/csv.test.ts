import { describe, it, expect } from "vitest";
import { parseCashValueCsv } from "../csv";

describe("parseCashValueCsv", () => {
  it("parses a valid CSV with required headers", () => {
    const csv = `year,cash_value
2030,100000
2031,110000
2035,200000`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([
      { year: 2030, cashValue: 100000 },
      { year: 2031, cashValue: 110000 },
      { year: 2035, cashValue: 200000 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("tolerates whitespace + case in headers", () => {
    const csv = `Year , Cash_Value
2030, 100000`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([{ year: 2030, cashValue: 100000 }]);
  });

  it("rejects missing year header", () => {
    const csv = `foo,cash_value
2030,100000`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatch(/missing required header: year/i);
  });

  it("reports row-level parse errors with row numbers", () => {
    const csv = `year,cash_value
2030,abc
2031,110000`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([{ year: 2031, cashValue: 110000 }]);
    expect(result.errors[0]).toMatch(/row 2.*non-numeric/i);
  });

  it("rejects out-of-range years", () => {
    const csv = `year,cash_value
1700,100000`;
    const result = parseCashValueCsv(csv);
    expect(result.errors[0]).toMatch(/out of range/i);
  });

  it("rejects duplicate years", () => {
    const csv = `year,cash_value
2030,100000
2030,110000`;
    const result = parseCashValueCsv(csv);
    expect(result.errors[0]).toMatch(/duplicate year/i);
  });

  it("returns an error for an empty file", () => {
    const result = parseCashValueCsv("");
    expect(result.errors[0]).toMatch(/empty csv/i);
  });

  it("rejects rows with fewer cells than headers", () => {
    const csv = `year,cash_value
2030,100000
2031`; // missing cash_value on row 3
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([{ year: 2030, cashValue: 100000 }]);
    expect(result.errors[0]).toMatch(/row 3.*expected 2 columns/i);
  });

  it("skips blank interior lines silently", () => {
    const csv = `year,cash_value
2030,100000

2031,110000`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([
      { year: 2030, cashValue: 100000 },
      { year: 2031, cashValue: 110000 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("accumulates multiple row errors without short-circuiting", () => {
    const csv = `year,cash_value
2030,abc
1700,100000
2032,-500`;
    const result = parseCashValueCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/row 2.*non-numeric/i);
    expect(result.errors[1]).toMatch(/row 3.*out of range/i);
    expect(result.errors[2]).toMatch(/row 4.*non-numeric or negative/i);
  });
});
