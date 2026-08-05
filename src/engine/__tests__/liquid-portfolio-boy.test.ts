import { describe, it, expect } from "vitest";
import { liquidPortfolioBoy } from "../portfolio-snapshot";
import type { ProjectionYear } from "../types";

type BoyYear = Pick<ProjectionYear, "year" | "portfolioAssets" | "accountLedgers">;

/** Only the slice `liquidPortfolioBoy` reads: the bucket→account maps, the
 *  reconciling `liquidTotal`, and each ledger's beginning/ending value. Buckets
 *  left out are skipped by the weight helpers, so naming one is enough. */
function yr(
  year: number,
  over: {
    liquidTotal?: number;
    buckets?: Partial<Record<string, Record<string, number>>>;
    ledgers?: Record<string, { beginningValue: number; endingValue: number }>;
  } = {},
): BoyYear {
  return {
    year,
    portfolioAssets: { ...over.buckets, liquidTotal: over.liquidTotal ?? 0 },
    accountLedgers: over.ledgers ?? {},
  } as unknown as BoyYear;
}

describe("liquidPortfolioBoy", () => {
  it("rolls the prior year's liquidTotal forward", () => {
    const years = [
      yr(2026, { liquidTotal: 900_000 }),
      yr(2027, { liquidTotal: 950_000 }),
    ];

    expect(liquidPortfolioBoy(years[1], years)).toBe(900_000);
  });

  it("finds the prior year in the full projection, not by array position", () => {
    // The visible window can start mid-projection; BoY must still be the actual
    // prior-year ending balance rather than "the row above me".
    const years = [
      yr(2026, { liquidTotal: 900_000 }),
      yr(2027, { liquidTotal: 950_000 }),
      yr(2028, { liquidTotal: 990_000 }),
    ];

    expect(liquidPortfolioBoy(years[2], years)).toBe(950_000);
  });

  it("falls back in year 1 to the beginning value of the accounts that compose liquidTotal", () => {
    // Real estate has a ledger like every other account, but it is net worth,
    // not portfolio — counting it would inflate the denominator of any
    // withdrawal rate taken against this figure.
    const y = yr(2026, {
      buckets: { taxable: { tax1: 400_000 }, cash: { cash1: 100_000 } },
      ledgers: {
        tax1: { beginningValue: 380_000, endingValue: 400_000 },
        cash1: { beginningValue: 95_000, endingValue: 100_000 },
        house: { beginningValue: 750_000, endingValue: 780_000 },
      },
    });

    expect(liquidPortfolioBoy(y, [y])).toBe(475_000);
  });

  it("counts only the owned share of a co-owned account in the year-1 fallback", () => {
    // The bucket holds the owned fraction (value × percent); the ledger is
    // whole-account. A half-owned account contributes half its beginning value.
    const y = yr(2026, {
      buckets: { taxable: { tax1: 50_000 } },
      ledgers: { tax1: { beginningValue: 80_000, endingValue: 100_000 } },
    });

    expect(liquidPortfolioBoy(y, [y])).toBe(40_000);
  });

  it("returns zero in year 1 when nothing is in a liquid bucket", () => {
    const y = yr(2026, {
      buckets: { realEstate: { house: 750_000 } },
      ledgers: { house: { beginningValue: 750_000, endingValue: 780_000 } },
    });

    expect(liquidPortfolioBoy(y, [y])).toBe(0);
  });
});
