import { describe, it, expect } from "vitest";
import { existingCoverageInForce } from "../existing-coverage";
import type { Account, ClientData } from "@/engine/types";

function policy(over: Partial<Account> & { name: string }): Account {
  return {
    id: over.name,
    category: "life_insurance",
    subType: "term",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    insuredPerson: "client",
    owners: [],
    ...over,
  } as Account;
}

function data(accounts: Account[]): ClientData {
  return {
    accounts,
    client: { dateOfBirth: "1970-01-01", retirementAge: 65 },
  } as unknown as ClientData;
}

describe("existingCoverageInForce", () => {
  it("includes a term policy in force in the death year", () => {
    const d = data([
      policy({
        name: "Term A",
        lifeInsurance: {
          faceValue: 500_000,
          policyType: "term",
          termIssueYear: 2020,
          termLengthYears: 20,
          endsAtInsuredRetirement: false,
        } as Account["lifeInsurance"],
      }),
    ]);
    const r = existingCoverageInForce(d, "client", 2030);
    expect(r.total).toBe(500_000);
    expect(r.policies).toEqual([{ name: "Term A", faceValue: 500_000 }]);
  });

  it("excludes a term policy that has expired by the death year", () => {
    const d = data([
      policy({
        name: "Term A",
        lifeInsurance: {
          faceValue: 500_000,
          policyType: "term",
          termIssueYear: 2000,
          termLengthYears: 20,
          endsAtInsuredRetirement: false,
        } as Account["lifeInsurance"],
      }),
    ]);
    const r = existingCoverageInForce(d, "client", 2030);
    expect(r.total).toBe(0);
    expect(r.policies).toEqual([]);
  });

  it("always includes permanent policies and excludes other-insured policies", () => {
    const d = data([
      policy({
        name: "Whole Life",
        subType: "whole",
        lifeInsurance: { faceValue: 250_000, policyType: "whole" } as Account["lifeInsurance"],
      }),
      policy({
        name: "Spouse Term",
        insuredPerson: "spouse",
        lifeInsurance: {
          faceValue: 999_000,
          policyType: "term",
          termIssueYear: 2020,
          termLengthYears: 30,
          endsAtInsuredRetirement: false,
        } as Account["lifeInsurance"],
      }),
    ]);
    const r = existingCoverageInForce(d, "client", 2030);
    expect(r.total).toBe(250_000);
    expect(r.policies).toEqual([{ name: "Whole Life", faceValue: 250_000 }]);
  });
});
