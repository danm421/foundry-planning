import { describe, it, expect } from "vitest";
import { portfolioTotalBoy } from "../portfolio-snapshot";
import type { ProjectionYear } from "../types";

type BoyYear = Pick<ProjectionYear, "year" | "portfolioAssets" | "accountLedgers">;

/** Only the slice `portfolioTotalBoy` reads: the bucket→account maps, the
 *  legacy `total`, and each ledger's beginning/ending value. */
function yr(
  year: number,
  over: {
    total?: number;
    buckets?: Partial<Record<string, Record<string, number>>>;
    ledgers?: Record<string, { beginningValue: number; endingValue: number }>;
  } = {},
): BoyYear {
  return {
    year,
    portfolioAssets: { ...over.buckets, total: over.total ?? 0 },
    accountLedgers: over.ledgers ?? {},
  } as unknown as BoyYear;
}

describe("portfolioTotalBoy", () => {
  it("rolls the prior year's total forward", () => {
    const years = [yr(2026, { total: 1_000_000 }), yr(2027, { total: 1_100_000 })];

    expect(portfolioTotalBoy(years[1], years)).toBe(1_000_000);
  });

  it("finds the prior year in the full projection, not by array position", () => {
    const years = [
      yr(2026, { total: 1_000_000 }),
      yr(2027, { total: 1_100_000 }),
      yr(2028, { total: 1_200_000 }),
    ];

    expect(portfolioTotalBoy(years[2], years)).toBe(1_100_000);
  });

  it("counts illiquid net-worth buckets in the year-1 fallback, unlike liquidPortfolioBoy", () => {
    // `total` is net worth's asset side — real estate and business belong here
    // even though they are excluded from `liquidTotal`.
    const y = yr(2026, {
      buckets: {
        taxable: { tax1: 400_000 },
        realEstate: { house: 780_000 },
        business: { biz: 200_000 },
      },
      ledgers: {
        tax1: { beginningValue: 380_000, endingValue: 400_000 },
        house: { beginningValue: 750_000, endingValue: 780_000 },
        biz: { beginningValue: 190_000, endingValue: 200_000 },
      },
    });

    expect(portfolioTotalBoy(y, [y])).toBe(380_000 + 750_000 + 190_000);
  });

  it("excludes locked trust/business shares, which `total` never counted", () => {
    // trustsAndBusinesses is a routing bucket outside the eight category
    // buckets that compose `total`; counting it here would make BoY and EoY
    // measure different things.
    const y = yr(2026, {
      buckets: {
        cash: { cash1: 100_000 },
        trustsAndBusinesses: { trust1: 500_000 },
      },
      ledgers: {
        cash1: { beginningValue: 95_000, endingValue: 100_000 },
        trust1: { beginningValue: 480_000, endingValue: 500_000 },
      },
    });

    expect(portfolioTotalBoy(y, [y])).toBe(95_000);
  });

  it("counts only the owned share of a co-owned account in the year-1 fallback", () => {
    const y = yr(2026, {
      buckets: { taxable: { tax1: 50_000 } },
      ledgers: { tax1: { beginningValue: 80_000, endingValue: 100_000 } },
    });

    expect(portfolioTotalBoy(y, [y])).toBe(40_000);
  });
});
