import { describe, it, expect } from "vitest";
import { rmdEraTierWarning } from "../rmd-era-tier-warning";
import type { MedicareDetectorContext } from "../types";

function makeYear(year: number, age: number, tier: number, surcharge: number) {
  return {
    year,
    ages: { client: age, spouse: undefined },
    medicare: {
      client: {
        enrolled: age >= 65,
        age, partBPremium: 2350 + surcharge, partBStandardPremium: 2350, partBIrmaaSurcharge: surcharge,
        partDPremium: 467, partDIrmaaSurcharge: 0, medigapPremium: 2040,
        totalAnnualCost: 2350 + surcharge + 467 + 2040,
        sourceYearForIrmaa: year - 2, sourceMagi: 100_000,
        irmaaTier: tier, irmaaFilingStatus: "mfj" as const,
        headroomToNextTier: 0, isColdStart: false,
      },
      totalAnnualCost: 4857 + surcharge,
      totalIrmaaSurcharge: surcharge,
    },
  } as any;
}

const baseCtx: Omit<MedicareDetectorContext, "years"> = {
  expenses: [],
  medicareCoverage: [{ owner: "client", enrollmentYear: 2025 }],
  rmdStartAges: { client: 73 },
};

describe("rmd-era-tier-warning", () => {
  it("fires when post-RMD avg tier >= 2 and pre-RMD avg tier <= 1", () => {
    const years = [
      makeYear(2025, 65, 0, 0),
      makeYear(2030, 70, 0, 0),
      makeYear(2034, 74, 2, 2350),
      makeYear(2040, 80, 2, 2350),
    ];
    const result = rmdEraTierWarning({ ...baseCtx, years });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("rmd-era");
    expect(result!.totalSurchargeOverWindow).toBeGreaterThan(0);
  });

  it("does not fire when post-RMD avg tier <= 1", () => {
    const years = [
      makeYear(2025, 65, 0, 0),
      makeYear(2034, 74, 1, 940),
      makeYear(2040, 80, 1, 940),
    ];
    const result = rmdEraTierWarning({ ...baseCtx, years });
    expect(result).toBeNull();
  });

  it("does not fire when pre-RMD avg tier already >= 2 (no new jump)", () => {
    const years = [
      makeYear(2025, 65, 2, 2350),
      makeYear(2030, 70, 2, 2350),
      makeYear(2034, 74, 2, 2350),
      makeYear(2040, 80, 2, 2350),
    ];
    const result = rmdEraTierWarning({ ...baseCtx, years });
    expect(result).toBeNull();
  });
});
