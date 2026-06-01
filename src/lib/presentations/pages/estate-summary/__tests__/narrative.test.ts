import { describe, it, expect } from "vitest";
import { buildNarrative } from "../narrative";
import type { EstateSummaryHousehold } from "../aggregate";

const today: EstateSummaryHousehold = {
  federal: 0, state: 0, probate: 30_000, ird: 0, debts: 0,
  netToHeirs: 3_900_000, taxAndCosts: 30_000, estateValue: 3_930_000,
};
const eol: EstateSummaryHousehold = {
  federal: 1_650_000, state: 320_000, probate: 40_000, ird: 90_000, debts: 0,
  netToHeirs: 6_300_000, taxAndCosts: 2_100_000, estateValue: 8_400_000,
};

describe("buildNarrative", () => {
  it("leads with end-of-life shrinkage vs today", () => {
    const lines = buildNarrative({ today, eol, isMarried: true, firstDeathTaxedEol: false, inTrustShareEol: 0.43 });
    expect(lines[0]).toContain("end of life");
    expect(lines[0]).toContain("25%"); // 2.1M / 8.4M
  });
  it("names federal as the dominant driver", () => {
    const lines = buildNarrative({ today, eol, isMarried: true, firstDeathTaxedEol: false, inTrustShareEol: 0.43 }).join(" ");
    expect(lines.toLowerCase()).toContain("federal");
  });
  it("notes the marital-deduction shelter when first death is untaxed and married", () => {
    const lines = buildNarrative({ today, eol, isMarried: true, firstDeathTaxedEol: false, inTrustShareEol: 0.43 }).join(" ");
    expect(lines.toLowerCase()).toContain("marital deduction");
  });
  it("reports the in-trust share", () => {
    const lines = buildNarrative({ today, eol, isMarried: false, firstDeathTaxedEol: false, inTrustShareEol: 0.43 }).join(" ");
    expect(lines).toContain("43%");
  });
});
