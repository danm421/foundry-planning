import { describe, it, expect } from "vitest";
import type { Account } from "@/engine/types";
import { isPolicyInForce } from "./insurance-in-force";

function termPolicy(opts: {
  termIssueYear: number | null;
  termLengthYears: number | null;
  endsAtInsuredRetirement?: boolean;
}): Account {
  return {
    id: "p1",
    name: "Term",
    category: "life_insurance",
    subType: "term",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [],
    insuredPerson: "client",
    lifeInsurance: {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: 0,
      premiumYears: null,
      policyType: "term",
      termIssueYear: opts.termIssueYear,
      termLengthYears: opts.termLengthYears,
      endsAtInsuredRetirement: opts.endsAtInsuredRetirement ?? false,
      cashValueGrowthMode: "basic",
      postPayoutMergeAccountId: null,
      postPayoutGrowthRate: 0,
      cashValueSchedule: [],
    },
  };
}

function wholePolicy(opts: { endsAtInsuredRetirement?: boolean } = {}): Account {
  return {
    ...termPolicy({ termIssueYear: null, termLengthYears: null }),
    subType: "whole",
    lifeInsurance: {
      ...termPolicy({ termIssueYear: null, termLengthYears: null }).lifeInsurance!,
      policyType: "whole",
      endsAtInsuredRetirement: opts.endsAtInsuredRetirement ?? false,
    },
  };
}

describe("isPolicyInForce", () => {
  it("term policy in window is in force", () => {
    const p = termPolicy({ termIssueYear: 2020, termLengthYears: 20 });
    expect(isPolicyInForce(p, 2025, null)).toBe(true);
  });

  it("term policy before issue is not in force", () => {
    const p = termPolicy({ termIssueYear: 2030, termLengthYears: 20 });
    expect(isPolicyInForce(p, 2025, null)).toBe(false);
  });

  it("term policy at expiry year is not in force (half-open interval)", () => {
    const p = termPolicy({ termIssueYear: 2020, termLengthYears: 20 });
    expect(isPolicyInForce(p, 2040, null)).toBe(false);
  });

  it("term policy with null termIssueYear is not in force", () => {
    const p = termPolicy({ termIssueYear: null, termLengthYears: 20 });
    expect(isPolicyInForce(p, 2025, null)).toBe(false);
  });

  it("term policy with null termLengthYears is not in force", () => {
    const p = termPolicy({ termIssueYear: 2020, termLengthYears: null });
    expect(isPolicyInForce(p, 2025, null)).toBe(false);
  });

  it("whole policy is always in force when endsAtInsuredRetirement is false", () => {
    const p = wholePolicy();
    expect(isPolicyInForce(p, 2025, 2030)).toBe(true);
    expect(isPolicyInForce(p, 2099, null)).toBe(true);
  });

  it("whole policy with endsAtInsuredRetirement drops at retirement year", () => {
    const p = wholePolicy({ endsAtInsuredRetirement: true });
    expect(isPolicyInForce(p, 2029, 2030)).toBe(true);
    expect(isPolicyInForce(p, 2030, 2030)).toBe(false);
    expect(isPolicyInForce(p, 2031, 2030)).toBe(false);
  });

  it("term with endsAtInsuredRetirement drops at the earlier of expiry or retirement", () => {
    const p = termPolicy({
      termIssueYear: 2020,
      termLengthYears: 30,
      endsAtInsuredRetirement: true,
    });
    expect(isPolicyInForce(p, 2030, 2035)).toBe(true);
    expect(isPolicyInForce(p, 2035, 2035)).toBe(false);
    expect(isPolicyInForce(p, 2049, 2055)).toBe(true);
    expect(isPolicyInForce(p, 2050, 2055)).toBe(false);
  });

  it("non-life-insurance account returns false", () => {
    const p: Account = {
      id: "x",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 100_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [],
    };
    expect(isPolicyInForce(p, 2025, null)).toBe(false);
  });
});
