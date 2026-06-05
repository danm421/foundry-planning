import { describe, it, expect } from "vitest";
import type { Account } from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";
import { runProjection } from "../projection";
import { buildClientData } from "./fixtures";

// Asset-only setup: drop fixture cash-flow so the engine doesn't run household
// accounting against a single non-investable account. Mirrors the pattern in
// portfolio-assets-buckets.test.ts.
function projectWith(accounts: Account[]) {
  return runProjection(
    buildClientData({
      accounts,
      incomes: [],
      expenses: [],
      savingsRules: [],
      withdrawalStrategy: [],
      liabilities: [],
    }),
  );
}

const annuity: Account = {
  id: "annuity-1",
  name: "Prudential Annuity",
  category: "annuity",
  subType: "other",
  titlingType: "jtwros",
  value: 315_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("annuity as a held asset", () => {
  it("appears in accountLedgers at its value", () => {
    const [year0] = projectWith([annuity]);
    const ledger = year0.accountLedgers["annuity-1"];
    expect(ledger).toBeDefined();
    expect(ledger.beginningValue).toBe(315_000);
    expect(ledger.endingValue).toBe(315_000); // 0% growth, no drawdown
  });

  it("is excluded from the investable portfolioAssets buckets", () => {
    const [year0] = projectWith([annuity]);
    expect(year0.portfolioAssets.cash["annuity-1"]).toBeUndefined();
    expect(year0.portfolioAssets.taxable["annuity-1"]).toBeUndefined();
    expect(year0.portfolioAssets.retirement["annuity-1"]).toBeUndefined();
  });
});
