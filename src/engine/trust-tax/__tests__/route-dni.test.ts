import { describe, it, expect } from "vitest";
import { routeDni } from "../route-dni";
import type { EntitySummary } from "../../types";

describe("routeDni", () => {
  it("splits DNI across multiple income beneficiaries by percentage", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      distributionMode: "fixed",
      distributionAmount: 100_000,
      incomeBeneficiaries: [
        { familyMemberId: "fm-spouse", percentage: 60 },
        { externalBeneficiaryId: "ext-charity", percentage: 40 },
      ],
    };
    const dniAmount = 80_000;
    const result = routeDni(trust.incomeBeneficiaries, dniAmount);

    expect(result.toFamilyMember).toEqual({ "fm-spouse": 48_000 });
    expect(result.toExternal).toEqual({ "ext-charity": 32_000 });
    expect(result.toHousehold).toBe(0);
  });

  it("routes household-role income beneficiaries back to household tax pass", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      distributionMode: "fixed",
      distributionAmount: 100_000,
      incomeBeneficiaries: [
        { householdRole: "spouse", percentage: 100 },
      ],
    };
    const result = routeDni(trust.incomeBeneficiaries, 50_000);
    expect(result.toHousehold).toBe(50_000);
    expect(result.toFamilyMember).toEqual({});
  });

  it("returns zeroes when incomeBeneficiaries is empty", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      distributionMode: "fixed",
      distributionAmount: 0,
      incomeBeneficiaries: [],
    };
    const result = routeDni(trust.incomeBeneficiaries, 10_000);
    expect(result.toFamilyMember).toEqual({});
    expect(result.toExternal).toEqual({});
    expect(result.toHousehold).toBe(0);
  });

  it("returns zeroes when dniAmount is zero", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      distributionMode: "fixed",
      distributionAmount: 100_000,
      incomeBeneficiaries: [
        { familyMemberId: "fm-spouse", percentage: 100 },
      ],
    };
    const result = routeDni(trust.incomeBeneficiaries, 0);
    expect(result.toFamilyMember).toEqual({});
    expect(result.toExternal).toEqual({});
    expect(result.toHousehold).toBe(0);
  });

  it("accumulates shares when the same familyMemberId appears more than once", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      distributionMode: "fixed",
      distributionAmount: 100_000,
      incomeBeneficiaries: [
        { familyMemberId: "fm-child", percentage: 30 },
        { familyMemberId: "fm-child", percentage: 20 },
      ],
    };
    const result = routeDni(trust.incomeBeneficiaries, 100_000);
    expect(result.toFamilyMember).toEqual({ "fm-child": 50_000 });
  });

  it("routes client householdRole to household", () => {
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: false,
      isGrantor: false,
      distributionMode: "fixed",
      distributionAmount: 100_000,
      incomeBeneficiaries: [
        { householdRole: "client", percentage: 100 },
      ],
    };
    const result = routeDni(trust.incomeBeneficiaries, 20_000);
    expect(result.toHousehold).toBe(20_000);
    expect(result.toFamilyMember).toEqual({});
    expect(result.toExternal).toEqual({});
  });
});
