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

  ["MA", 2_000_000,         0],
  ["MA", 4_250_000,         179_040],
  // Full $20M ladder: 74,880 + 40K + 44K + 96K + 104K + 112K + 120K + 128K + 136K + 1,593,600
  ["MA", 20_000_000,        2_448_480],

  ["MN", 3_000_000,         0],
  ["MN", 5_000_000,         260_000],
  // 7.1M@13% (923K) + 1M@13.6% + 1M@14.4% + 1M@15.2% + 1.9M@16%
  ["MN", 15_000_000,        1_659_000],

  ["NY", 7_160_000,         0],
  // Below cliff (7.518M); tax = $340K × 13.6% in $7.1M-$8.1M band
  ["NY", 7_500_000,         46_240],
  ["NY", 8_000_000,         773_200],

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
