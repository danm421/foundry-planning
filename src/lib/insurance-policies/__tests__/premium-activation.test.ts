import { describe, it, expect } from "vitest";
import { resolvePremiumSchedule } from "../premium-expense";
import type { Account } from "@/engine/types";

function termPolicyAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "li1", name: "Term policy", category: "life_insurance", subType: "term",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners: [],
    insuredPerson: "client",
    lifeInsurance: {
      faceValue: 1_000_000, costBasis: 0, premiumAmount: 5000, premiumYears: 20,
      premiumPayer: "client", policyType: "term", termIssueYear: 2030, termLengthYears: 20,
      endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
      premiumScheduleMode: "off", deathBenefitScheduleMode: "off", incomeScheduleMode: "off",
      postPayoutGrowthRate: 0, cashValueSchedule: [],
    },
    ...overrides,
  } as Account;
}

describe("premium synthesis — activation", () => {
  it("clamps premium startYear up to the account activation year", () => {
    const acct = termPolicyAccount({ activationYear: 2035 });
    const res = resolvePremiumSchedule(acct, { currentYear: 2025 } as never);
    expect(res?.startYear).toBe(2035); // not 2030
  });

  it("no activation ⇒ premiums start at issue year as before", () => {
    const acct = termPolicyAccount({ activationYear: null });
    const res = resolvePremiumSchedule(acct, { currentYear: 2025 } as never);
    expect(res?.startYear).toBe(2030);
  });
});
