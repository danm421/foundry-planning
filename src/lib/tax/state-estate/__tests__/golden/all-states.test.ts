import { describe, it, expect } from "vitest";
import { computeStateEstateTax } from "../../compute";
import type { StateCode } from "../../types";

// Each entry is hand-calculated from data/state-estate-tax-2026.xlsx (Tax Brackets Detail sheet).
// Format: [state, taxableEstate, expectedTax].
const CASES: Array<[StateCode, number, number]> = [
  ["CT", 14_999_999, 0],
  ["CT", 20_000_000,        600_000],
  ["CT", 100_000_000,       10_200_000],

  ["DC", 4_873_200,         0],
  ["DC", 5_000_000,         14_201.6],
  // 14,201.6 + 120K + 128K + 136K + 144K + 152K + 80K
  ["DC", 10_500_000,        774_201.6],

  ["HI", 5_490_000,         0],
  ["HI", 6_000_000,         51_000],
  // 100K + 110K + 120K + 130K + 140K + 785K + 902K (4.51M @ 20%)
  ["HI", 20_000_000,        2_287_000],

  ["IL", 4_040_000,         0],
  ["IL", 10_000_000,        953_600],

  ["ME", 7_000_000,         0],
  ["ME", 10_000_000,        240_000],
  ["ME", 15_000_000,        780_000],

  ["MD", 5_000_000,         0],
  ["MD", 6_000_000,         160_000],
  ["MD", 20_000_000,        2_400_000],

  // MA (MGL c.65C as amended Oct 2023): pre-2002 §2011 state-death-credit table
  // applied to the WHOLE taxable estate from $0, less a fixed $99,600 credit, floor 0.
  ["MA", 1_940_000,         0],         // credit fully absorbs table tax at/below $1.94M
  ["MA", 2_000_000,         4_320],     // 103,920 table − 99,600
  ["MA", 3_000_000,         87_680],    // 187,280 table − 99,600
  ["MA", 4_250_000,         214_720],   // 314,320 table − 99,600
  ["MA", 5_000_000,         298_720],   // 398,320 table − 99,600
  ["MA", 10_000_000,        977_120],   // 1,076,720 table − 99,600
  ["MA", 20_000_000,        2_576_800], // 2,676,400 table − 99,600

  ["MN", 3_000_000,         0],
  ["MN", 5_000_000,         260_000],
  // 7.1M@13% (923K) + 1M@13.6% + 1M@14.4% + 1M@15.2% + 1.9M@16%
  ["MN", 15_000_000,        1_659_000],

  // NY phase-out band (exemption $7.16M → 105% cliff $7.518M), NY Tax Law §952(c)(2):
  // whole estate taxed from $0, less a credit phasing linearly from $658,960 (= table tax
  // at the exemption) to $0 at the cliff. Continuous up to the cliff value (707,648).
  ["NY", 7_160_000,         0],         // at the exemption → fully credited
  ["NY", 7_300_000,         276_734],   // 678,000 table − 401,266 phased credit
  ["NY", 7_500_000,         672_068],   // 705,200 table − 33,132 phased credit
  ["NY", 8_000_000,         773_200],   // above the cliff → entire estate, no credit

  ["OR", 1_000_000,         0],
  ["OR", 2_000_000,         101_250],
  ["OR", 12_000_000,        1_422_500],

  ["RI", 1_802_431,         0],
  ["RI", 2_000_000,         1_580.55],

  ["VT", 5_000_000,         0],
  ["VT", 7_500_000,         400_000],
  ["VT", 20_000_000,        2_400_000],

  ["WA", 3_000_000,         0],
  ["WA", 4_000_000,         150_000],
  // 150K + 170K + 190K + 220K + 250K + 300K + 1,050K (3M@35%)
  ["WA", 12_000_000,        2_330_000],
];

describe("Golden state estate tax cases — all 13 jurisdictions", () => {
  for (const [state, taxableEstate, expected] of CASES) {
    it(`${state}: $${taxableEstate.toLocaleString()} → $${expected.toLocaleString()}`, () => {
      const r = computeStateEstateTax({
        state,
        deathYear: 2026,
        taxableEstate,
        adjustedTaxableGifts: 0,
        fallbackFlatRate: 0,
      });
      expect(r.stateEstateTax).toBeCloseTo(expected, 0);
    });
  }
});
