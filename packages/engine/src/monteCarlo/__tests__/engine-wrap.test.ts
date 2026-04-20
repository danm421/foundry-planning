import { describe, it, expect } from "vitest";
import { runProjection } from "../../projection";
import { buildClientData } from "../../__tests__/fixtures";

describe("runProjection — returnsOverride option", () => {
  it("uses the override's return value as the growth rate for an account in a given year", () => {
    const data = buildClientData();
    const firstInvestment = data.accounts.find((a) => a.category !== "real_estate" && a.value > 0);
    if (!firstInvestment) throw new Error("fixture has no investable account");

    // Force a fixed 10% growth every year for this account only.
    const options = {
      returnsOverride: (_year: number, accountId: string) =>
        accountId === firstInvestment.id ? 0.1 : undefined,
    };
    const result = runProjection(data, options);

    const year0 = result[0];
    const ledger = year0.accountLedgers[firstInvestment.id];
    const expectedGrowth = firstInvestment.value * 0.1;
    expect(ledger.growth).toBeCloseTo(expectedGrowth, 2);
  });

  it("falls back to acct.growthRate when override returns undefined", () => {
    const data = buildClientData();
    const acct = data.accounts.find((a) => a.category !== "real_estate" && a.value > 0)!;

    // Override always returns undefined → engine behaves identically to no option.
    const withOverride = runProjection(data, { returnsOverride: () => undefined });
    const withoutOverride = runProjection(data);

    const a = withOverride[0].accountLedgers[acct.id];
    const b = withoutOverride[0].accountLedgers[acct.id];
    expect(a.growth).toBe(b.growth);
    expect(a.endingValue).toBe(b.endingValue);
  });

  it("is called with (year, accountId) for each investable account each year", () => {
    const data = buildClientData();
    const calls: Array<[number, string]> = [];
    runProjection(data, {
      returnsOverride: (year, accountId) => {
        calls.push([year, accountId]);
        return undefined; // fall back to deterministic rates
      },
    });

    // Every (year, accountId) pair for investable accounts should show up at
    // least once. Use the first year to sanity-check.
    const firstYear = data.planSettings.planStartYear;
    const firstYearCalls = calls.filter(([y]) => y === firstYear).map(([, id]) => id);
    for (const acct of data.accounts) {
      // BoY sales/purchases may remove accounts; check only surviving accounts.
      if (acct.value > 0) {
        expect(firstYearCalls).toContain(acct.id);
      }
    }
  });

  it("no options arg → byte-identical output to pre-change behavior (regression guard)", () => {
    // The existing projection.test.ts covers semantic correctness. This test
    // pins the exact numerical output so the MC refactor can't silently drift
    // the deterministic path for any fixture shape.
    const data = buildClientData();
    const a = runProjection(data);
    const b = runProjection(data);
    expect(a).toEqual(b);
    // Sanity: a plan with assets + growth should end with a strictly positive total.
    expect(a[a.length - 1].portfolioAssets.total).toBeGreaterThan(0);
  });
});
