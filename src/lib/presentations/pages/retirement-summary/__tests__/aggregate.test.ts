import { describe, it, expect } from "vitest";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import {
  fmtUsd, fmtPct, retirementYearOf, liquidThreePoints, portfolioBars,
  assetsByTaxType, livingExpensesTodayVsRetirement,
} from "../aggregate";

function pa(over: Partial<ProjectionYear["portfolioAssets"]>) {
  return {
    taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {},
    lifeInsurance: {}, trustsAndBusinesses: {}, accessibleTrustAssets: {},
    taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0,
    businessTotal: 0, lifeInsuranceTotal: 0, trustsAndBusinessesTotal: 0,
    accessibleTrustAssetsTotal: 0, total: 0, liquidTotal: 0, ...over,
  };
}
function yr(year: number, over: Partial<ProjectionYear>): ProjectionYear {
  return { year, portfolioAssets: pa({}), accountLedgers: {}, expenses: {} as never, ...over } as unknown as ProjectionYear;
}

describe("fmtUsd / fmtPct", () => {
  it("formats compactly", () => {
    expect(fmtUsd(2_400_000)).toBe("$2.4M");
    expect(fmtUsd(31_000)).toBe("$31k");
    expect(fmtPct(0.92)).toBe("92%");
  });
});

describe("retirementYearOf", () => {
  it("is birth year + retirement age", () => {
    const cd = { client: { dateOfBirth: "1966-05-01", retirementAge: 65 } } as ClientData;
    expect(retirementYearOf(cd)).toBe(2031);
  });
});

describe("liquidThreePoints", () => {
  it("reads liquidTotal at now, retirement, and last year", () => {
    const years = [
      yr(2026, { portfolioAssets: pa({ liquidTotal: 2_400_000 }) }),
      yr(2031, { portfolioAssets: pa({ liquidTotal: 3_100_000 }) }),
      yr(2056, { portfolioAssets: pa({ liquidTotal: 1_800_000 }) }),
    ];
    expect(liquidThreePoints(years, 2031)).toEqual({ now: 2_400_000, retirement: 3_100_000, endOfLife: 1_800_000 });
  });
});

describe("portfolioBars", () => {
  it("extracts cash/taxable/retirement totals per year", () => {
    const years = [yr(2026, { portfolioAssets: pa({ cashTotal: 1, taxableTotal: 2, retirementTotal: 3 }) })];
    expect(portfolioBars(years)).toEqual([{ year: 2026, cash: 1, taxable: 2, retirement: 3, total: 6 }]);
  });
});

describe("assetsByTaxType", () => {
  it("splits roth_ira and the 401k roth slice from pre-tax", () => {
    const accounts: Account[] = [
      { id: "roth", category: "retirement", subType: "roth_ira" } as Account,
      { id: "k", category: "retirement", subType: "401k" } as Account,
      { id: "brk", category: "taxable", subType: "brokerage" } as Account,
    ];
    const cd = { accounts, client: { dateOfBirth: "1966-01-01", retirementAge: 65 } } as ClientData;
    const years = [yr(2031, {
      portfolioAssets: pa({}),
      accountLedgers: {
        roth: { endingValue: 100_000, rothValueEoY: 0 },
        k: { endingValue: 200_000, rothValueEoY: 50_000 },
        brk: { endingValue: 300_000, rothValueEoY: 0 },
      } as never,
    })];
    expect(assetsByTaxType(years, cd, 2031)).toEqual({ roth: 150_000, preTax: 150_000, taxable: 300_000, total: 600_000 });
  });
});

describe("livingExpensesTodayVsRetirement", () => {
  it("compares today's living-expense dollars to the retirement-year living total", () => {
    const cd = {
      client: { dateOfBirth: "1966-01-01", retirementAge: 65 },
      expenses: [
        { id: "e1", type: "living", annualAmount: 80_000 },
        { id: "e2", type: "other", annualAmount: 5_000 },
      ],
    } as unknown as ClientData;
    const years = [yr(2031, { expenses: { living: 110_000 } as never })];
    expect(livingExpensesTodayVsRetirement(years, cd, 2031)).toEqual({ today: 80_000, retirement: 110_000 });
  });
});
