import { describe, it, expect } from "vitest";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import {
  fmtUsd, fmtPct, fmtUsdMonthly, retirementYearOf, liquidThreePoints, portfolioBars,
  assetsByType, assetsByTaxType, livingExpensesTodayVsRetirement, printsAsZero,
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

describe("printsAsZero", () => {
  // The guard on every "only show this if there is one" figure. `x > 0` is not
  // that test: fmtUsd rounds sub-dollar residue to "$0", and a page that warns
  // about a shortfall of "$0" reads as broken.
  it("is true for anything fmtUsd renders as $0", () => {
    expect(printsAsZero(0)).toBe(true);
    expect(printsAsZero(0.34)).toBe(true);
    expect(printsAsZero(1)).toBe(false);
    expect(printsAsZero(250_000)).toBe(false);
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
      portfolioAssets: pa({
        retirement: { roth: 100_000, k: 200_000 }, retirementTotal: 300_000,
        taxable: { brk: 300_000 }, taxableTotal: 300_000,
      }),
      accountLedgers: {
        roth: { endingValue: 100_000, rothValueEoY: 0 },
        k: { endingValue: 200_000, rothValueEoY: 50_000 },
        brk: { endingValue: 300_000, rothValueEoY: 0 },
      } as never,
    })];
    expect(assetsByTaxType(years, cd, 2031)).toEqual({ roth: 150_000, preTax: 150_000, taxable: 300_000, total: 600_000 });
  });

  // A9: cash is a taxable account. Dropping it made the "by tax type" column of
  // the retirement-summary page total $4.9M against the "by type" column's
  // $8.6M — the same snapshot, two answers, on one page.
  it("counts cash as taxable", () => {
    const accounts: Account[] = [
      { id: "chk", category: "cash", subType: "checking" } as Account,
      { id: "brk", category: "taxable", subType: "brokerage" } as Account,
    ];
    const cd = { accounts, client: { dateOfBirth: "1966-01-01", retirementAge: 65 } } as ClientData;
    const years = [yr(2031, {
      portfolioAssets: pa({
        cash: { chk: 3_600_000 }, cashTotal: 3_600_000,
        taxable: { brk: 400_000 }, taxableTotal: 400_000,
      }),
      accountLedgers: {
        chk: { endingValue: 3_600_000 },
        brk: { endingValue: 400_000 },
      } as never,
    })];
    expect(assetsByTaxType(years, cd, 2031)).toEqual({
      roth: 0, preTax: 0, taxable: 4_000_000, total: 4_000_000,
    });
  });

  // A9 second order: the two columns read different sources — `assetsByType`
  // takes the engine's owned-share roll-ups, `assetsByTaxType` took whole-account
  // ledgers. A half-owned account made them disagree even with cash counted.
  it("totals to assetsByType — it reads the same owned shares", () => {
    const accounts: Account[] = [
      { id: "chk", category: "cash", subType: "checking" } as Account,
      { id: "k", category: "retirement", subType: "401k" } as Account,
    ];
    const cd = { accounts, client: { dateOfBirth: "1966-01-01", retirementAge: 65 } } as ClientData;
    const years = [yr(2031, {
      portfolioAssets: pa({
        cash: { chk: 50_000 }, cashTotal: 50_000,          // 50% owned of a $100k account
        retirement: { k: 100_000 }, retirementTotal: 100_000, // 50% owned of a $200k account
      }),
      accountLedgers: {
        chk: { endingValue: 100_000 },
        k: { endingValue: 200_000, rothValueEoY: 50_000 },
      } as never,
    })];
    const byTax = assetsByTaxType(years, cd, 2031);
    const byType = assetsByType(years, 2031);
    expect(byTax.total).toBe(byType.total);
    // The Roth slice scales with the owned share too: 50% of $50k.
    expect(byTax).toEqual({ roth: 25_000, preTax: 75_000, taxable: 50_000, total: 150_000 });
  });

  // An account the projection creates mid-flight is in the portfolio buckets but
  // not in `clientData.accounts`. It has to land somewhere, or the column silently
  // shrinks; pre-tax is the conservative bucket for an unknown retirement account.
  it("keeps accounts absent from clientData in the total", () => {
    const cd = { accounts: [], client: { dateOfBirth: "1966-01-01", retirementAge: 65 } } as unknown as ClientData;
    const years = [yr(2031, {
      portfolioAssets: pa({
        retirement: { mystery: 10_000 }, retirementTotal: 10_000,
      }),
      accountLedgers: { mystery: { endingValue: 10_000 } } as never,
    })];
    expect(assetsByTaxType(years, cd, 2031)).toEqual({
      roth: 0, preTax: 10_000, taxable: 0, total: 10_000,
    });
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
