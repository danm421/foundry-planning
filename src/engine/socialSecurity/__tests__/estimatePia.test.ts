import { describe, expect, it } from "vitest";
import { estimatePiaMonthly } from "../estimatePia";

const BENDS = { first: 1226, second: 7391 };
const BASE = { ssWageBase: 184_500, bendPoints: BENDS };

describe("estimatePiaMonthly", () => {
  it("applies 90% below the first bend point", () => {
    // 35 years at $12,000 -> AIME = 420000/420 = $1,000/mo, all in band 1.
    const pia = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 12_000, yearsEmployed: 35, futureYears: 0 });
    expect(pia).toBeCloseTo(900, 0);
  });

  it("applies 32% in the second band", () => {
    // AIME $2,000: 0.9*1226 + 0.32*(2000-1226) = 1103.4 + 247.68 = 1351.08
    const pia = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 24_000, yearsEmployed: 35, futureYears: 0 });
    expect(pia).toBeCloseTo(1351.08, 1);
  });

  it("applies 15% above the second bend point", () => {
    // AIME $10,000: 0.9*1226 + 0.32*(7391-1226) + 0.15*(10000-7391)
    const expected = 0.9 * 1226 + 0.32 * (7391 - 1226) + 0.15 * (10_000 - 7391);
    const pia = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 120_000, yearsEmployed: 35, futureYears: 0 });
    expect(pia).toBeCloseTo(expected, 1);
  });

  it("caps covered earnings at the wage base", () => {
    const capped = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 500_000, yearsEmployed: 35, futureYears: 0 });
    const atBase = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 184_500, yearsEmployed: 35, futureYears: 0 });
    expect(capped).toBe(atBase);
  });

  it("counts past plus future years, capped at 35", () => {
    const short = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 60_000, yearsEmployed: 10, futureYears: 0 });
    const full = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 60_000, yearsEmployed: 10, futureYears: 25 });
    const over = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 60_000, yearsEmployed: 20, futureYears: 40 });
    expect(full).toBeGreaterThan(short);
    expect(over).toBe(full);
  });

  it("returns 0 for a non-earner", () => {
    expect(estimatePiaMonthly({ ...BASE, highestAnnualSalary: 0, yearsEmployed: 0, futureYears: 0 })).toBe(0);
    expect(estimatePiaMonthly({ ...BASE, highestAnnualSalary: -5, yearsEmployed: 10, futureYears: 0 })).toBe(0);
  });

  it("is deterministic", () => {
    const a = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 166_750, yearsEmployed: 17, futureYears: 25 });
    const b = estimatePiaMonthly({ ...BASE, highestAnnualSalary: 166_750, yearsEmployed: 17, futureYears: 25 });
    expect(a).toBe(b);
  });
});
