import { describe, it, expect } from "vitest";
import {
  taxSummaryOptionsSchema,
  TAX_SUMMARY_OPTIONS_DEFAULT,
} from "../options-schema";
import type { ProjectionYear } from "@/engine/types";
import { fmtUsd, fmtPct, computeLifetimeTotals } from "../aggregate";

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
