import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { TaxResult, BracketTier } from "@/lib/tax/types";
import { buildTaxBracketRows } from "../bracket";

const tier12: BracketTier = { from: 23200, to: 94300, rate: 0.12 };
const tier22: BracketTier = { from: 94300, to: 201050, rate: 0.22 };
const tier37: BracketTier = { from: 383900, to: null, rate: 0.37 };

function makeTaxResult(incomeTaxBase: number, tier: BracketTier): TaxResult {
  // Hand-crafted — we only populate fields the adapter reads.
  return {
    flow: { incomeTaxBase } as TaxResult["flow"],
    diag: {
      marginalFederalRate: tier.rate,
      marginalBracketTier: tier,
      effectiveFederalRate: 0,
      // bracketsUsed and inflationFactor unused by the adapter.
    } as TaxResult["diag"],
  } as TaxResult;
}

function makeYear(
  year: number,
  base: number,
  tier: BracketTier,
  conversions: { id: string; name: string; gross: number; taxable: number }[] = [],
): ProjectionYear {
  return {
    year,
    ages: { client: 50 + (year - 2026), spouse: 46 + (year - 2026) },
    taxResult: makeTaxResult(base, tier),
    rothConversions: conversions.length > 0 ? conversions : undefined,
  } as unknown as ProjectionYear;
}

describe("buildTaxBracketRows", () => {
  it("computes YoY change in income tax base, with first year = 0", () => {
    const years: ProjectionYear[] = [
      makeYear(2026, 100_000, tier22),
      makeYear(2027, 150_000, tier22),
      makeYear(2028, 120_000, tier22),
    ];
    const rows = buildTaxBracketRows(years);
    expect(rows[0].changeInBase).toBe(0);
    expect(rows[1].changeInBase).toBe(50_000);
    expect(rows[2].changeInBase).toBe(-30_000); // negative allowed
  });

  it("returns null remaining for the top bracket (to === null)", () => {
    const rows = buildTaxBracketRows([makeYear(2026, 500_000, tier37)]);
    expect(rows[0].remainingInBracket).toBeNull();
    expect(rows[0].intoBracket).toBe(500_000 - 383_900);
  });

  it("a fill-up-bracket year drives remaining to ~0", () => {
    // Income tax base sits exactly at top of 22% bracket → remaining = 0.
    const rows = buildTaxBracketRows([makeYear(2026, 201_050, tier22)]);
    expect(rows[0].remainingInBracket).toBe(0);
    expect(rows[0].intoBracket).toBe(201_050 - 94_300);
  });

  it("sums conversion gross + taxable across multiple conversions in a year", () => {
    const rows = buildTaxBracketRows([
      makeYear(2026, 150_000, tier22, [
        { id: "a", name: "A", gross: 50_000, taxable: 40_000 },
        { id: "b", name: "B", gross: 25_000, taxable: 20_000 },
      ]),
    ]);
    expect(rows[0].conversionGross).toBe(75_000);
    expect(rows[0].conversionTaxable).toBe(60_000);
  });

  it("zeroes conversion columns for years with no conversions", () => {
    const rows = buildTaxBracketRows([makeYear(2026, 100_000, tier22)]);
    expect(rows[0].conversionGross).toBe(0);
    expect(rows[0].conversionTaxable).toBe(0);
  });

  it("ages: spouse is null when only client age is present", () => {
    const single = {
      year: 2026,
      ages: { client: 50 },
      taxResult: makeTaxResult(50_000, tier12),
    } as unknown as ProjectionYear;
    const rows = buildTaxBracketRows([single]);
    expect(rows[0].clientAge).toBe(50);
    expect(rows[0].spouseAge).toBeNull();
  });
});
