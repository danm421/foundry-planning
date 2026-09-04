import { describe, it, expect } from "vitest";
import {
  resolveTaxAdjustmentsForYear,
  sumTaxAdjustments,
  type TaxAdjustmentRow,
} from "../tax-adjustments";

function row(over: Partial<TaxAdjustmentRow> = {}): TaxAdjustmentRow {
  return {
    id: "a1",
    taxType: "ordinary_income",
    name: "Completed Roth conversion",
    annualAmount: 100_000,
    growthRate: 0,
    startYear: 2026,
    endYear: 2026,
    withheldMode: "none",
    withheldValue: 0,
    ...over,
  };
}

describe("resolveTaxAdjustmentsForYear — bucket routing", () => {
  // Each tax type must land in its OWN bucket and no other. Asserting the
  // whole `byTaxType` map (not just the one field) is what makes this test
  // fail if two types are ever swapped in the switch.
  const CASES: Array<[TaxAdjustmentRow["taxType"], string]> = [
    ["earned_income", "earned_income"],
    ["ordinary_income", "ordinary_income"],
    ["dividends", "dividends"],
    ["capital_gains", "capital_gains"],
    ["stcg", "stcg"],
    ["qbi", "qbi"],
    ["tax_exempt", "tax_exempt"],
    ["muni_interest", "muni_interest"],
  ];

  for (const [taxType, bucket] of CASES) {
    it(`routes ${taxType} to ${bucket} and leaves every other bucket at 0`, () => {
      const r = resolveTaxAdjustmentsForYear([row({ taxType })], 2026);
      for (const [key, value] of Object.entries(r.byTaxType)) {
        expect(value, `bucket ${key}`).toBe(key === bucket ? 100_000 : 0);
      }
    });
  }
});

describe("resolveTaxAdjustmentsForYear — taxable total", () => {
  it("excludes tax_exempt from taxableTotal but keeps it in its bucket", () => {
    const r = resolveTaxAdjustmentsForYear([row({ taxType: "tax_exempt" })], 2026);
    expect(r.byTaxType.tax_exempt).toBe(100_000);
    expect(r.taxableTotal).toBe(0);
  });

  it("includes every other type in taxableTotal", () => {
    const r = resolveTaxAdjustmentsForYear([row({ taxType: "dividends" })], 2026);
    expect(r.taxableTotal).toBe(100_000);
  });

  it("reports capital gains split by character for the flat-mode back-out", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ id: "lt", taxType: "capital_gains", annualAmount: 40_000 }),
       row({ id: "st", taxType: "stcg", annualAmount: 10_000 })],
      2026,
    );
    expect(r.capitalGainsLt).toBe(40_000);
    expect(r.capitalGainsSt).toBe(10_000);
    expect(r.taxableTotal).toBe(50_000);
  });

  it("subtracts a negative amount", () => {
    const r = resolveTaxAdjustmentsForYear([row({ annualAmount: -25_000 })], 2026);
    expect(r.byTaxType.ordinary_income).toBe(-25_000);
    expect(r.taxableTotal).toBe(-25_000);
  });
});

describe("resolveTaxAdjustmentsForYear — year range and growth", () => {
  it("contributes nothing before startYear or after endYear", () => {
    const rows = [row({ startYear: 2028, endYear: 2030 })];
    expect(resolveTaxAdjustmentsForYear(rows, 2027).taxableTotal).toBe(0);
    expect(resolveTaxAdjustmentsForYear(rows, 2031).taxableTotal).toBe(0);
    expect(resolveTaxAdjustmentsForYear(rows, 2028).taxableTotal).toBe(100_000);
  });

  it("compounds growth from startYear", () => {
    const rows = [row({ startYear: 2026, endYear: 2030, growthRate: 0.03 })];
    expect(resolveTaxAdjustmentsForYear(rows, 2028).taxableTotal).toBeCloseTo(
      100_000 * 1.03 ** 2, 6,
    );
  });

  it("returns an all-zero result for undefined rows", () => {
    const r = resolveTaxAdjustmentsForYear(undefined, 2026);
    expect(r.taxableTotal).toBe(0);
    expect(r.alreadyPaid).toBe(0);
    expect(Object.keys(r.bySource)).toHaveLength(0);
  });
});

describe("resolveTaxAdjustmentsForYear — withholding", () => {
  it("takes a dollar amount verbatim", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ withheldMode: "amount", withheldValue: 32_000 })], 2026,
    );
    expect(r.alreadyPaid).toBe(32_000);
  });

  it("resolves a percent against the GROWN amount, not the entered base", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ startYear: 2026, endYear: 2030, growthRate: 0.03,
             withheldMode: "percent", withheldValue: 0.225 })],
      2028,
    );
    expect(r.alreadyPaid).toBeCloseTo(100_000 * 1.03 ** 2 * 0.225, 6);
  });

  it("ignores withholding on a negative adjustment", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ annualAmount: -50_000, withheldMode: "amount", withheldValue: 9_000 })],
      2026,
    );
    expect(r.alreadyPaid).toBe(0);
  });

  it("ignores withholding when the mode is none", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ withheldMode: "none", withheldValue: 9_000 })], 2026,
    );
    expect(r.alreadyPaid).toBe(0);
  });
});

describe("bySource", () => {
  it("keys each row by tax_adjustment:<id> with its type and grown amount", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ id: "abc", taxType: "qbi", annualAmount: 10_000 })], 2026,
    );
    expect(r.bySource).toEqual({
      "tax_adjustment:abc": { type: "qbi", amount: 10_000 },
    });
  });
});

describe("sumTaxAdjustments", () => {
  it("sums only tax_adjustment entries out of a taxDetail bySource map", () => {
    const total = sumTaxAdjustments({
      earnedIncome: 0, ordinaryIncome: 0, dividends: 0, capitalGains: 0,
      stCapitalGains: 0, qbi: 0, taxExempt: 0, taxExemptInterest: 0,
      bySource: {
        "tax_adjustment:a": { type: "ordinary_income", amount: 100_000 },
        "tax_adjustment:b": { type: "capital_gains", amount: -5_000 },
        "salary:x": { type: "earned_income", amount: 250_000 },
      },
    });
    expect(total).toBe(95_000);
  });

  it("returns 0 for an absent taxDetail", () => {
    expect(sumTaxAdjustments(undefined)).toBe(0);
  });
});

describe("resolveTaxAdjustmentsForYear — municipal bond interest", () => {
  it("routes muni_interest to its own bucket", () => {
    const r = resolveTaxAdjustmentsForYear([row({ taxType: "muni_interest" })], 2026);
    expect(r.byTaxType.muni_interest).toBe(100_000);
    expect(r.byTaxType.tax_exempt).toBe(0);
  });

  // THE GUARD TEST. `tax-adjustments.ts:90` excludes only "tax_exempt" by
  // name, so any new type falls through into taxableTotal. Municipal bond
  // interest is not taxable income; if this passes with the old guard, the
  // guard was never widened.
  it("keeps muni_interest OUT of taxableTotal", () => {
    const r = resolveTaxAdjustmentsForYear([row({ taxType: "muni_interest" })], 2026);
    expect(r.taxableTotal).toBe(0);
  });

  it("keeps muni_interest out of both capital-gains slices", () => {
    const r = resolveTaxAdjustmentsForYear([row({ taxType: "muni_interest" })], 2026);
    expect(r.capitalGainsLt).toBe(0);
    expect(r.capitalGainsSt).toBe(0);
  });

  it("names a muni adjustment in the drill-down with its own type", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ id: "muni-1", taxType: "muni_interest", annualAmount: 50_000 })],
      2026,
    );
    expect(r.bySource["tax_adjustment:muni-1"]).toEqual({
      type: "muni_interest",
      amount: 50_000,
    });
  });

  it("subtracts a negative muni adjustment without making it taxable", () => {
    const r = resolveTaxAdjustmentsForYear(
      [row({ taxType: "muni_interest", annualAmount: -20_000 })],
      2026,
    );
    expect(r.byTaxType.muni_interest).toBe(-20_000);
    expect(r.taxableTotal).toBe(0);
  });
});
