import { describe, it, expect } from "vitest";
import { synthesizeLtcPremiums, withSynthesizedLtcPremiums } from "../ltc-premium-expense";
import { withSynthesizedPremiums } from "../premium-expense";
import { buildClientData, baseClient } from "@/engine/__tests__/fixtures";
import type { ClientData, LtcPolicy } from "@/engine/types";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

// baseClient: client born 1970-01-01, co-client 1972-06-15; plan 2026–2055.
const client: ClientData["client"] = { ...baseClient, lifeExpectancy: 90, spouseLifeExpectancy: 92 };
const policy = (over: Partial<LtcPolicy> = {}): LtcPolicy => ({
  id: "ltc-1", name: "Genworth", insured: "client", carrier: null, issueYear: 2018,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null, ...over,
});
const tree = (p: LtcPolicy, c = client) => buildClientData({ client: c, expenses: [], ltcPolicies: [p] });
const billedYears = (p: LtcPolicy, c = client) => {
  const [row] = synthesizeLtcPremiums(tree(p, c));
  return row ? [row.startYear, row.endYear] : null;
};

describe("synthesizeLtcPremiums", () => {
  it("bills a level premium from the plan start through the insured's life-expectancy year", () => {
    const [row] = synthesizeLtcPremiums(tree(policy()));
    expect(row).toEqual({
      id: "ltc-premium-ltc-1", type: "insurance", name: "Genworth premium", annualAmount: 2400,
      startYear: 2026, endYear: 2060, growthRate: 0, source: "policy",
    });
  });

  it("starts in the issue year when the policy is issued after the plan starts", () => {
    expect(billedYears(policy({ issueYear: 2030 }))).toEqual([2030, 2060]);
  });

  it("stops the year before the pay-to age, or after the pay years counted from issue", () => {
    expect(billedYears(policy({ premiumPayMode: "to_age", premiumPayToAge: 65 }))).toEqual([2026, 2034]);
    expect(billedYears(policy({ premiumPayMode: "years", premiumPayYears: 10, issueYear: 2020 }))).toEqual([2026, 2029]);
  });

  // The engine never ends an `insurance` expense at a death, so the window must.
  it("stops a pay-years premium in the insured's life-expectancy year", () => {
    const le82 = { ...client, lifeExpectancy: 82 }; // dies 2052
    const tenPay = (issueYear: number) => policy({ premiumPayMode: "years", premiumPayYears: 10, issueYear });
    expect(billedYears(tenPay(2045), le82)).toEqual([2045, 2052]);
    expect(billedYears(tenPay(2055), le82)).toBeNull();
  });

  it("stops a pay-to-age premium in the insured's life-expectancy year, the co-client falling back to the client's", () => {
    const le60 = { ...client, lifeExpectancy: 60 }; // client dies 2030
    const payTo65 = (over: Partial<LtcPolicy> = {}) => policy({ premiumPayMode: "to_age", premiumPayToAge: 65, ...over });
    expect(billedYears(payTo65(), le60)).toEqual([2026, 2030]);
    // Co-client born 1972, no expectancy of their own → the client's 60 → 2032.
    expect(billedYears(payTo65({ insured: "spouse" }), { ...le60, spouseLifeExpectancy: null })).toEqual([2026, 2032]);
  });

  it("bills nothing once the pay years ended before the plan, for paid-up, for $0, or for a rider", () => {
    expect(billedYears(policy({ premiumPayMode: "years", premiumPayYears: 10, issueYear: 2010 }))).toBeNull();
    expect(billedYears(policy({ premiumPayMode: "paid_up" }))).toBeNull();
    expect(billedYears(policy({ annualPremium: 0 }))).toBeNull();
    expect(billedYears(policy({ ...LTC_RIDER_DEFAULTS, annualPremium: 2400 }))).toBeNull();
  });

  it("follows the co-client's own birth year and life expectancy, falling back to the client's expectancy", () => {
    expect(billedYears(policy({ insured: "spouse" }))).toEqual([2026, 2064]);
    expect(billedYears(policy({ insured: "spouse" }), { ...client, spouseLifeExpectancy: null })).toEqual([2026, 2062]);
  });

  // Review Focus 2: no date of birth → no row. Never a guessed year.
  it("bills nothing for a co-client with no date of birth", () => {
    expect(billedYears(policy({ insured: "spouse" }), { ...client, spouseDob: undefined })).toBeNull();
  });
});

describe("withSynthesizedLtcPremiums", () => {
  it("is idempotent: a second pass leaves one row", () => {
    const once = withSynthesizedLtcPremiums(tree(policy()));
    const twice = withSynthesizedLtcPremiums(once);
    expect(twice.expenses.filter((e) => e.id.startsWith("ltc-premium-"))).toHaveLength(1);
  });

  // ORDERING INVARIANT: the life-insurance link strips every `source: "policy"`
  // row and regenerates only life premiums — so the LTC link must run after it.
  it("survives only when it runs AFTER withSynthesizedPremiums", () => {
    const ltcRows = (t: ReturnType<typeof tree>) => t.expenses.filter((e) => e.id.startsWith("ltc-premium-"));
    expect(ltcRows(withSynthesizedLtcPremiums(withSynthesizedPremiums(tree(policy()))))).toHaveLength(1);
    expect(ltcRows(withSynthesizedPremiums(withSynthesizedLtcPremiums(tree(policy()))))).toHaveLength(0);
  });
});
