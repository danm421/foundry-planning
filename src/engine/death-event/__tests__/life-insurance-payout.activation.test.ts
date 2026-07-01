import { describe, it, expect } from "vitest";
import { prepareLifeInsurancePayouts } from "../life-insurance-payout";
import type { Account } from "@/engine/types";

function policyAccount(activationYear: number | null): Account {
  return {
    id: "li1", name: "Term", category: "life_insurance", subType: "term",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners: [],
    insuredPerson: "client", activationYear,
    lifeInsurance: {
      faceValue: 1_000_000, costBasis: 0, premiumAmount: 0, premiumYears: null,
      premiumPayer: "client", policyType: "term", termIssueYear: 2035, termLengthYears: 20,
      endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
      premiumScheduleMode: "off", deathBenefitScheduleMode: "off", incomeScheduleMode: "off",
      postPayoutGrowthRate: 0, cashValueSchedule: [],
    },
  } as Account;
}

const baseInput = {
  deceased: "client" as const, eventKind: "first_death" as const,
  accountBalances: {}, basisMap: {}, entities: [],
};

describe("LI death payout — activation guard", () => {
  it("does NOT pay out when death precedes activation", () => {
    const res = prepareLifeInsurancePayouts({ ...baseInput, year: 2032, accounts: [policyAccount(2035)] });
    expect(res.lifeInsurancePayouts).toHaveLength(0);
    expect(res.accounts[0].category).toBe("life_insurance"); // untransformed
  });

  it("DOES pay out when death is at/after activation", () => {
    const res = prepareLifeInsurancePayouts({ ...baseInput, year: 2036, accounts: [policyAccount(2035)] });
    expect(res.lifeInsurancePayouts).toHaveLength(1);
    expect(res.accounts[0].category).toBe("taxable"); // §101(a) proceeds
  });
});
