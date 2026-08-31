import { describe, it, expect } from "vitest";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import {
  fmtUsd, fmtPct, fmtUsdMonthly, retirementYearOf, liquidThreePoints, portfolioBars,
  assetsByTaxType, livingExpensesTodayVsRetirement,
} from "../aggregate";

function pa(over: Partial<ProjectionYear["portfolioAssets"]>) {
  return {
    taxable: {}, cash: {}, retirement: {}, annuity: {}, realEstate: {}, business: {},
    lifeInsurance: {}, stockOptions: {}, trustsAndBusinesses: {}, accessibleTrustAssets: {},
    taxableTotal: 0, cashTotal: 0, retirementTotal: 0, annuityTotal: 0, realEstateTotal: 0,
    businessTotal: 0, lifeInsuranceTotal: 0, stockOptionsTotal: 0, trustsAndBusinessesTotal: 0,
    accessibleTrustAssetsTotal: 0, total: 0, liquidTotal: 0, ...over,
  };
}
function yr(year: number, over: Partial<ProjectionYear>): ProjectionYear {
  return { year, portfolioAssets: pa({}), accountLedgers: {}, expenses: {} as never, ...over } as unknown as ProjectionYear;
}
/** Minimal account ledger: only the two values the BoY roll-forward reads. */
function led(beginningValue: number, endingValue: number) {
  return { beginningValue, endingValue, growth: 0, contributions: 0, distributions: 0 } as never;
}

describe("fmtUsd / fmtPct", () => {
  it("formats compactly", () => {
    expect(fmtUsd(2_400_000)).toBe("$2.4M");
    expect(fmtUsd(31_000)).toBe("$31k");
    expect(fmtPct(0.92)).toBe("92%");
  });
});

describe("fmtUsdMonthly", () => {
  it("keeps full dollars so the SS ladder gradient stays visible", () => {
    expect(fmtUsdMonthly(2_800)).toBe("$2,800");
    expect(fmtUsdMonthly(1_960.4)).toBe("$1,960");
  });
});

describe("retirementYearOf", () => {
  it("is birth year + retirement age", () => {
    const cd = { client: { dateOfBirth: "1966-05-01", retirementAge: 65 } } as ClientData;
    expect(retirementYearOf(cd)).toBe(2031);
  });
});

describe("liquidThreePoints", () => {
  // "Now" is the only one of the three that means *today*. A projection row is
  // an END-of-year snapshot, so reading year 1's `liquidTotal` handed the KPI a
  // balance that already includes a full year of growth, savings and
  // withdrawals — money the client does not have yet. Retirement and end-of-life
  // are genuinely future points, so those stay on the end-of-year figure.
  it("reads today's balance for `now` — before year 1's growth", () => {
    const years = [
      yr(2026, {
        portfolioAssets: pa({ taxable: { brk: 2_400_000 }, taxableTotal: 2_400_000, liquidTotal: 2_400_000 }),
        accountLedgers: { brk: led(2_000_000, 2_400_000) },
      }),
      yr(2031, { portfolioAssets: pa({ liquidTotal: 3_100_000 }) }),
      yr(2056, { portfolioAssets: pa({ liquidTotal: 1_800_000 }) }),
    ];
    expect(liquidThreePoints(years, 2031)).toEqual({
      now: 2_000_000,
      retirement: 3_100_000,
      endOfLife: 1_800_000,
    });
  });

  // Only the buckets that compose `liquidTotal` count. A house is on the ledger
  // like everything else, so an unfiltered beginning-value sum would quietly
  // report net worth as the liquid portfolio.
  it("excludes illiquid accounts from `now`", () => {
    const years = [
      yr(2026, {
        portfolioAssets: pa({
          cash: { chk: 100_000 },
          cashTotal: 100_000,
          realEstate: { house: 900_000 },
          realEstateTotal: 900_000,
          liquidTotal: 100_000,
        }),
        accountLedgers: { chk: led(90_000, 100_000), house: led(850_000, 900_000) },
      }),
    ];
    expect(liquidThreePoints(years, 2026).now).toBe(90_000);
  });

  it("is 0 with no projection years", () => {
    expect(liquidThreePoints([], 2031)).toEqual({ now: 0, retirement: 0, endOfLife: 0 });
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
  it("shows the retirement living expense present value as 'today', excluding the current-living row", () => {
    // Two seeded living rows: current (anchored at plan start) and retirement
    // (anchored after plan start, entered in today's dollars). "today" must be
    // the retirement row's present value only, not current + retirement summed.
    const cd = {
      client: { dateOfBirth: "1966-01-01", retirementAge: 65 },
      planSettings: { planStartYear: 2025 },
      expenses: [
        { id: "cur", type: "living", annualAmount: 150_000, startYear: 2025 }, // current — excluded
        { id: "ret", type: "living", annualAmount: 100_000, startYear: 2035 }, // retirement PV — counted
        { id: "oth", type: "other", annualAmount: 5_000, startYear: 2025 },
      ],
    } as unknown as ClientData;
    const years = [
      yr(2025, { expenses: { living: 150_000 } as never }),
      yr(2035, { expenses: { living: 124_000 } as never }),
    ];
    expect(livingExpensesTodayVsRetirement(years, cd, 2035)).toEqual({ today: 100_000, retirement: 124_000 });
  });
});
