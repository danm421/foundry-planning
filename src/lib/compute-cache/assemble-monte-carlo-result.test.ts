import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/presentations/pages/monte-carlo/build-payload", () => ({
  buildMonteCarloReportPayload: vi.fn(() => ({
    summary: { trialsRun: 1000 },
    histogram: {},
    successRates: [1, 0.5],
    deterministic: [100, 50],
  })),
}));
vi.mock("@/lib/monte-carlo/annual-income", () => ({
  annualIncomeAtStart: vi.fn(() => 123456),
}));

import { assembleMonteCarloResult } from "./assemble-monte-carlo-result";

const tree = {
  client: {
    firstName: "Ada",
    lastName: "Byron",
    spouseName: "Charles",
    dateOfBirth: "1955-12-10",
    retirementAge: 65,
    spouseRetirementAge: 67,
  },
  planSettings: {},
} as never;

const mcPayload = {
  requiredMinimumAssetLevel: 10_000,
  startingLiquidBalance: 500_000,
} as never;

const raw = { successRate: 0.84, byYearLiquidAssetsPerTrial: [[1]], endingLiquidAssets: [1] } as never;
const projection = { years: [{ year: 2026 }, { year: 2027 }] } as never;

describe("assembleMonteCarloResult", () => {
  it("assembles payload, raw, and meta from tree + mcPayload + raw + projection", () => {
    const out = assembleMonteCarloResult({ tree, mcPayload, raw, projection });

    expect(out.raw).toBe(raw);
    expect(out.payload.deterministic).toEqual([100, 50]);
    expect(out.meta).toEqual({
      requiredMinimumAssetLevel: 10_000,
      startingLiquidBalance: 500_000,
      planStartYear: 2026,
      clientBirthYear: 1955,
      clientDisplayName: "Ada & Charles Byron",
      annualIncomeAtStart: 123456,
      retirementAge: 65,
      spouseRetirementAge: 67,
    });
  });

  it("falls back to a single-name display + undefined birth year when no spouse/DOB", () => {
    const solo = {
      planSettings: {},
      client: {
        firstName: "Ada",
        lastName: "Byron",
        spouseName: undefined,
        dateOfBirth: undefined,
        retirementAge: 65,
        spouseRetirementAge: 67,
      },
    } as never;
    const out = assembleMonteCarloResult({ tree: solo, mcPayload, raw, projection });
    expect(out.meta.clientDisplayName).toBe("Ada Byron");
    expect(out.meta.clientBirthYear).toBeUndefined();
  });
});
