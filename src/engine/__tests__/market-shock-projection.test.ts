import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, sampleAccounts } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

/** Sum of market-exposed (retirement + taxable) balances in a projection year. */
function marketBalance(year: ReturnType<typeof runProjection>[number]): number {
  return year.portfolioAssets.retirementTotal + year.portfolioAssets.taxableTotal;
}

describe("market shock — projection integration", () => {
  it("drops market-exposed balances in the shock year vs. no shock", () => {
    const SHOCK_YEAR = 2030;
    const baseData = buildClientData();
    const shockData = buildClientData({
      planSettings: { ...basePlanSettings, marketShock: { year: SHOCK_YEAR, drawdownPct: 0.3 } },
    });

    const baseRun = runProjection(baseData);
    const shockRun = runProjection(shockData);

    const findYear = (rows: typeof baseRun, y: number) => rows.find((r) => r.year === y)!;

    const baseShockYear = findYear(baseRun, SHOCK_YEAR);
    const shockShockYear = findYear(shockRun, SHOCK_YEAR);
    // Market-exposed balances should be materially lower in the shock run.
    expect(marketBalance(shockShockYear)).toBeLessThan(marketBalance(baseShockYear) * 0.85);

    // The pre-shock year is unaffected.
    const preBase = findYear(baseRun, SHOCK_YEAR - 1);
    const preShock = findYear(shockRun, SHOCK_YEAR - 1);
    expect(marketBalance(preShock)).toBeCloseTo(marketBalance(preBase), 0);
  });

  it("reports the crash in the Portfolio Growth scalar, not just in the entries", () => {
    // The "Portfolio Growth" row (cashflow report, presentation drill, asset
    // ledger summary) sums `accountLedgers[id].growth`. If the drawdown lands
    // only in `entries`, the crash year renders a normal positive growth number
    // — the crash is invisible on the one row that is supposed to show it.
    const SHOCK_YEAR = 2030;
    const shockRun = runProjection(
      buildClientData({
        planSettings: { ...basePlanSettings, marketShock: { year: SHOCK_YEAR, drawdownPct: 0.3 } },
      }),
    );
    const row = shockRun.find((r) => r.year === SHOCK_YEAR)!;

    let scalar = 0;
    let fromEntries = 0;
    for (const ledger of Object.values(row.accountLedgers)) {
      scalar += ledger.growth;
      fromEntries += ledger.entries
        .filter((e) => e.category === "growth")
        .reduce((s, e) => s + e.amount, 0);
    }
    expect(scalar).toBeCloseTo(fromEntries, 2);
    expect(scalar).toBeLessThan(0); // a 30% crash is a net-negative growth year
  });

  it("keeps a 401(k)'s Roth slice inside the account after the crash", () => {
    // rothValue is grown alongside the balance so the Roth fraction holds. A
    // shock that skips it leaves rothValueEoY above endingValue, which zeroes
    // the pre-tax RMD basis for every remaining year.
    const SHOCK_YEAR = 2030;
    const halfRoth: Account = {
      id: "acct-half-roth-401k",
      name: "Half-Roth 401(k)",
      category: "retirement",
      subType: "401k",
      titlingType: "jtwros",
      value: 500_000,
      basis: 0,
      rothValue: 250_000,
      growthRate: 0.07,
      rmdEnabled: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const shockRun = runProjection(
      buildClientData({
        accounts: [...sampleAccounts, halfRoth],
        planSettings: { ...basePlanSettings, marketShock: { year: SHOCK_YEAR, drawdownPct: 0.3 } },
      }),
    );
    const ledger = shockRun.find((r) => r.year === SHOCK_YEAR)!.accountLedgers[halfRoth.id];
    expect(ledger.rothValueEoY!).toBeLessThanOrEqual(ledger.endingValue);
    expect(ledger.rothValueEoY! / ledger.endingValue).toBeCloseTo(0.5, 3);
  });
});
