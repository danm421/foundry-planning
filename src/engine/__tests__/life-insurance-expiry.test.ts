import { describe, it, expect } from "vitest";
import { computeTermEndYear } from "../life-insurance-expiry";
import type { LifeInsurancePolicy, ClientInfo } from "../types";

const marriedClient: ClientInfo = {
  firstName: "C",
  lastName: "X",
  dateOfBirth: "1970-01-01", // client retires 1970 + 65 = 2035
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint",
  spouseName: "S",
  spouseDob: "1972-01-01", // spouse retires 1972 + 62 = 2034
  spouseRetirementAge: 62,
};

const singleClient: ClientInfo = {
  firstName: "C",
  lastName: "X",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
};

describe("computeTermEndYear", () => {
  it("returns null for non-term policies", () => {
    const policy: Partial<LifeInsurancePolicy> = { policyType: "whole" };
    expect(
      computeTermEndYear({
        policy: policy as LifeInsurancePolicy,
        insured: "client",
        client: marriedClient,
      }),
    ).toBe(null);
  });

  it("uses termLengthYears for fixed-term", () => {
    const policy: Partial<LifeInsurancePolicy> = {
      policyType: "term",
      termIssueYear: 2020,
      termLengthYears: 20,
      endsAtInsuredRetirement: false,
    };
    expect(
      computeTermEndYear({
        policy: policy as LifeInsurancePolicy,
        insured: "client",
        client: marriedClient,
      }),
    ).toBe(2039); // 2020 + 20 - 1
  });

  it("uses insured's retirement year when endsAtInsuredRetirement", () => {
    const policy: Partial<LifeInsurancePolicy> = {
      policyType: "term",
      termIssueYear: 2020,
      termLengthYears: null,
      endsAtInsuredRetirement: true,
    };
    expect(
      computeTermEndYear({
        policy: policy as LifeInsurancePolicy,
        insured: "client",
        client: marriedClient,
      }),
    ).toBe(2035);
  });

  it("for joint-insured ends-at-retirement, uses the later retirement", () => {
    const policy: Partial<LifeInsurancePolicy> = {
      policyType: "term",
      termIssueYear: 2020,
      termLengthYears: null,
      endsAtInsuredRetirement: true,
    };
    // Client 2035, spouse 2034 → later = 2035
    expect(
      computeTermEndYear({
        policy: policy as LifeInsurancePolicy,
        insured: "joint",
        client: marriedClient,
      }),
    ).toBe(2035);
  });

  it("throws if ends-at-retirement but spouse missing for spouse-insured", () => {
    const policy: Partial<LifeInsurancePolicy> = {
      policyType: "term",
      termIssueYear: 2020,
      termLengthYears: null,
      endsAtInsuredRetirement: true,
    };
    expect(() =>
      computeTermEndYear({
        policy: policy as LifeInsurancePolicy,
        insured: "spouse",
        client: singleClient,
      }),
    ).toThrow(/missing spouse/);
  });
});
