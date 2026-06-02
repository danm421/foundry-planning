import { describe, it, expect } from "vitest";
import {
  taxSummaryOptionsSchema,
  TAX_SUMMARY_OPTIONS_DEFAULT,
} from "../options-schema";
import type { ProjectionYear } from "@/engine/types";
import { fmtUsd, fmtPct, computeLifetimeTotals } from "../aggregate";
import {
  computeBracketExposure,
  buildTaxPaidBars,
  type TaxYearBar,
} from "../aggregate";
import type { TaxBracketRow } from "@/lib/tax/bracket";

function row(year: number, marginalRate: number): TaxBracketRow {
  return { year, marginalRate } as TaxBracketRow;
}

// Minimal ProjectionYear stub carrying only the tax fields these helpers read.
function yr(federal: number, state: number, cg: number, total: number, gross: number): ProjectionYear {
  return {
    taxResult: {
      flow: { totalFederalTax: federal, stateTax: state, capitalGainsTax: cg, totalTax: total },
      income: { grossTotalIncome: gross },
    },
  } as unknown as ProjectionYear;
}

describe("fmt", () => {
  it("abbreviates millions and thousands", () => {
    expect(fmtUsd(1_250_000)).toBe("$1.3M");
    expect(fmtUsd(340_000)).toBe("$340k");
    expect(fmtUsd(0)).toBe("$0");
  });
  it("renders whole-percent", () => {
    expect(fmtPct(0.184)).toBe("18%");
  });
});

describe("computeLifetimeTotals", () => {
  it("sums each tax stream and derives the effective rate", () => {
    const years = [
      yr(10_000, 2_000, 1_000, 13_000, 100_000),
      yr(20_000, 3_000, 5_000, 28_000, 150_000),
    ];
    const t = computeLifetimeTotals(years);
    expect(t.lifetimeFederal).toBe(30_000);
    expect(t.lifetimeState).toBe(5_000);
    expect(t.lifetimeCapGains).toBe(6_000);
    expect(t.lifetimeTotal).toBe(41_000);
    expect(t.effectiveRate).toBeCloseTo(41_000 / 250_000, 6);
  });

  it("treats years with no taxResult as zero and guards divide-by-zero", () => {
    const noTax = {} as ProjectionYear;
    const t = computeLifetimeTotals([noTax]);
    expect(t.lifetimeTotal).toBe(0);
    expect(t.effectiveRate).toBe(0);
  });
});

describe("computeBracketExposure", () => {
  it("counts years strictly below low and strictly above high; boundaries excluded", () => {
    const rows = [row(2030, 0.12), row(2031, 0.22), row(2032, 0.24), row(2033, 0.32), row(2034, 0.10)];
    const e = computeBracketExposure(rows, 0.22, 0.24);
    expect(e.yearsBelowLow).toBe(2);   // 0.12, 0.10
    expect(e.yearsAboveHigh).toBe(1);  // 0.32 (0.24 is not > 0.24)
    expect(e.minRate).toBeCloseTo(0.10, 6);
    expect(e.maxRate).toBeCloseTo(0.32, 6);
    expect(e.lowThreshold).toBe(0.22);
    expect(e.highThreshold).toBe(0.24);
  });

  it("returns zeroed counts and null rates for no rows", () => {
    const e = computeBracketExposure([], 0.22, 0.24);
    expect(e.yearsBelowLow).toBe(0);
    expect(e.yearsAboveHigh).toBe(0);
    expect(e.minRate).toBeNull();
    expect(e.maxRate).toBeNull();
  });
});

describe("buildTaxPaidBars", () => {
  it("splits federal into ordinary + cap gains and clamps ordinary at zero", () => {
    const years = [yr(10_000, 2_000, 4_000, 12_000, 100_000)];
    const bars: TaxYearBar[] = buildTaxPaidBars(years);
    expect(bars).toHaveLength(1);
    expect(bars[0].federalOrdinary).toBe(6_000); // 10000 - 4000
    expect(bars[0].capGains).toBe(4_000);
    expect(bars[0].state).toBe(2_000);
    expect(bars[0].total).toBe(12_000); // 6000 + 4000 + 2000
  });

  it("skips years with no taxResult", () => {
    const bars = buildTaxPaidBars([{ year: 2040 } as ProjectionYear]);
    expect(bars).toHaveLength(0);
  });
});

describe("taxSummaryOptionsSchema", () => {
  it("applies default thresholds when fields are omitted", () => {
    const parsed = taxSummaryOptionsSchema.parse({});
    expect(parsed).toEqual({ lowThreshold: 0.22, highThreshold: 0.24 });
  });

  it("exposes the same defaults as the exported constant", () => {
    expect(TAX_SUMMARY_OPTIONS_DEFAULT).toEqual({
      lowThreshold: 0.22,
      highThreshold: 0.24,
    });
  });
});
