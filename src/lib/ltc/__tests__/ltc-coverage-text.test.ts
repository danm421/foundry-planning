import { describe, it, expect } from "vitest";
import { ltcCoverageLines } from "../ltc-coverage-text";
import { baseClient } from "@/engine/__tests__/fixtures";
import type { LtcCoveragePerson } from "@/engine/ltc-event";
import type { LtcPolicyPayout } from "@/engine/ltc-benefits";

const payout = (over: Partial<LtcPolicyPayout> = {}): LtcPolicyPayout => ({
  policyId: "trad", name: "Genworth", kind: "standalone", person: "client",
  firstYear: 2055, monthlyLimit: 6000, paidByYear: {}, total: 198_000, ...over,
});
const person = (over: Partial<LtcCoveragePerson> = {}): LtcCoveragePerson => ({
  person: "client", startYear: 2055, endYear: 2057, totalCost: 360_000, totalCovered: 198_000,
  policies: [payout()], ...over,
});

describe("ltcCoverageLines", () => {
  it("policies switched off", () => {
    expect(ltcCoverageLines({ includePolicies: false, people: [person({ policies: [], totalCovered: 0 })] }, baseClient)).toEqual([
      "LTC policies are left out of this test. The household pays the full cost.",
    ]);
  });

  it("no coverage on file (spec copy)", () => {
    expect(ltcCoverageLines({ includePolicies: true, people: [person({ policies: [], totalCovered: 0 })] }, baseClient)).toEqual([
      "No LTC coverage on file. The household pays the full cost.",
    ]);
  });

  it("one traditional policy, over the whole care period", () => {
    // 198,000 / 360,000 = 55%
    expect(ltcCoverageLines({ includePolicies: true, people: [person()] }, baseClient)).toEqual([
      "Covered: Genworth pays up to $6,000/mo in 2055.",
      "Over care (2055–2057), the policy pays about $198,000 of the $360,000 cost (55%).",
    ]);
  });

  it("a traditional policy, a rider and one not in force, with the pay order stated", () => {
    const p = person({
      totalCovered: 318_000, // 198,000 + 120,000 → 318 / 360 = 88%
      policies: [
        payout(),
        payout({ policyId: "r", name: "Whole life rider", kind: "life_rider", monthlyLimit: 10_000, total: 120_000 }),
        payout({ policyId: "late", name: "Late policy", firstYear: null, monthlyLimit: 0, total: 0 }),
      ],
    });
    expect(ltcCoverageLines({ includePolicies: true, people: [p] }, baseClient)).toEqual([
      "Covered: Genworth pays up to $6,000/mo in 2055.",
      "Whole life rider pays up to $10,000/mo in 2055.",
      "Late policy isn't in force during this care, so it pays nothing.",
      "Traditional policies pay first, so the rider uses as little of the death benefit as it can.",
      "Over care (2055–2057), the policies pay about $318,000 of the $360,000 cost (88%).",
    ]);
  });

  it("two people in care are named; a single care year reads as one year", () => {
    const jane = person({ person: "spouse", startYear: 2058, endYear: 2058, totalCost: 125_400, totalCovered: 0, policies: [] });
    expect(ltcCoverageLines({ includePolicies: true, people: [person({ startYear: 2055, endYear: 2055 }), jane] }, baseClient)).toEqual([
      "Covered: Genworth pays up to $6,000/mo in 2055.",
      "Over John's care (2055), the policy pays about $198,000 of the $360,000 cost (55%).",
      "No LTC coverage on file for Jane. The household pays the full cost of their care.",
    ]);
  });
});
