import { describe, it, expect } from "vitest";
import { synthesizePolicyIncome } from "../policy-income";
import type { Account, LifeInsurancePolicy } from "@/engine/types";

function makeLifeAccount(
  over: Omit<Partial<Account>, "lifeInsurance"> & { lifeInsurance?: Partial<LifeInsurancePolicy> },
): Account {
  return {
    id: "pol-1",
    name: "WL Policy",
    category: "life_insurance",
    value: 0,
    growthRate: 0,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    insuredPerson: "client",
    lifeInsurance: {
      faceValue: 5_000_000, costBasis: 0, premiumAmount: 0, premiumYears: null,
      policyType: "whole", termIssueYear: null, termLengthYears: null,
      endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
      premiumScheduleMode: "off", deathBenefitScheduleMode: "off",
      incomeScheduleMode: "scheduled", postPayoutGrowthRate: 0.06,
      cashValueSchedule: [
        { year: 2040, income: 50_000 },
        { year: 2041, income: 52_000 },
      ],
      ...(over.lifeInsurance ?? {}),
    },
    ...over,
  } as Account;
}

describe("synthesizePolicyIncome", () => {
  it("emits one tax-exempt income per scheduled policy with overrides", () => {
    const [inc] = synthesizePolicyIncome([makeLifeAccount({})]);
    expect(inc.type).toBe("other");
    expect(inc.taxType).toBe("tax_exempt");
    expect(inc.scheduleOverrides).toEqual({ 2040: 50_000, 2041: 52_000 });
    expect(inc.startYear).toBe(2040);
    expect(inc.endYear).toBe(2041);
    expect(inc.sourcePolicyAccountId).toBe("pol-1");
  });

  it("routes entity-owned policy income to the entity", () => {
    const acct = makeLifeAccount({
      owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }],
    });
    const [inc] = synthesizePolicyIncome([acct]);
    expect(inc.ownerEntityId).toBe("ent-1");
  });

  it("emits nothing when mode is off or no income rows exist", () => {
    const off = makeLifeAccount({ lifeInsurance: { incomeScheduleMode: "off" } });
    expect(synthesizePolicyIncome([off])).toEqual([]);
  });
});
