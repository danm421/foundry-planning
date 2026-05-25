import { describe, it, expect } from "vitest";
import { survivorTierShock } from "../survivor-tier-shock";

function yr(year: number, opts: {
  clientAlive?: boolean; spouseAlive?: boolean;
  clientTier?: number; spouseTier?: number;
  clientFiling?: "mfj" | "single"; spouseFiling?: "mfj" | "single";
}) {
  const make = (alive: boolean, tier: number, filing: "mfj" | "single") => alive ? {
    enrolled: true, age: 75, partBPremium: 0, partBStandardPremium: 0, partBIrmaaSurcharge: 2350,
    partDPremium: 0, partDIrmaaSurcharge: 450, medigapPremium: 0, totalAnnualCost: 0,
    sourceYearForIrmaa: year - 2, sourceMagi: 200_000,
    irmaaTier: tier, irmaaFilingStatus: filing, headroomToNextTier: 0, isColdStart: false,
  } : undefined;
  return {
    year,
    ages: { client: 75, spouse: 73 },
    medicare: {
      client: make(opts.clientAlive ?? true, opts.clientTier ?? 0, opts.clientFiling ?? "mfj"),
      spouse: make(opts.spouseAlive ?? true, opts.spouseTier ?? 0, opts.spouseFiling ?? "mfj"),
      totalAnnualCost: 0, totalIrmaaSurcharge: 0,
    },
  } as any;
}

describe("survivor-tier-shock", () => {
  it("fires when MFJ tier 0 → single tier 3 after first death", () => {
    const years = [
      yr(2038, { clientAlive: true, spouseAlive: true, clientTier: 0, spouseTier: 0, clientFiling: "mfj", spouseFiling: "mfj" }),
      yr(2039, { clientAlive: true, spouseAlive: true, clientTier: 0, spouseTier: 0, clientFiling: "mfj", spouseFiling: "mfj" }),
      yr(2040, { clientAlive: true, spouseAlive: false, clientTier: 3, clientFiling: "single" }),
      yr(2041, { clientAlive: true, spouseAlive: false, clientTier: 3, clientFiling: "single" }),
    ];
    const result = survivorTierShock({ years, expenses: [], medicareCoverage: [], rmdStartAges: { client: 73, spouse: 73 } });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("survivor-shock");
  });

  it("does not fire when survivor remains in same tier", () => {
    const years = [
      yr(2038, { clientAlive: true, spouseAlive: true, clientTier: 1, spouseTier: 1, clientFiling: "mfj", spouseFiling: "mfj" }),
      yr(2040, { clientAlive: true, spouseAlive: false, clientTier: 1, clientFiling: "single" }),
    ];
    const result = survivorTierShock({ years, expenses: [], medicareCoverage: [], rmdStartAges: { client: 73, spouse: 73 } });
    expect(result).toBeNull();
  });
});
