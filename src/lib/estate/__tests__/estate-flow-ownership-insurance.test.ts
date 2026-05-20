import { describe, it, expect } from "vitest";
import { buildOwnershipColumn } from "../estate-flow-ownership";
import type { ClientData, Account } from "@/engine/types";

const baseClient = {
  client: {
    firstName: "Alice",
    lastName: "Smith",
    spouseName: "Bob",
    dateOfBirth: "1970-01-01",
    spouseDob: "1972-01-01",
    retirementAge: 65,
    spouseRetirementAge: 67,
    planEndAge: 95,
    filingStatus: "married_joint",
  },
  familyMembers: [
    {
      id: "fm-c",
      role: "client",
      firstName: "Alice",
      relationship: "other",
      lastName: "Smith",
      dateOfBirth: "1970-01-01",
    },
    {
      id: "fm-s",
      role: "spouse",
      firstName: "Bob",
      relationship: "other",
      lastName: "Smith",
      dateOfBirth: "1972-01-01",
    },
  ],
  entities: [
    { id: "ilit-1", name: "Alice ILIT", entityType: "trust", isIrrevocable: true },
  ],
  accounts: [],
  wills: [],
  liabilities: [],
} as unknown as ClientData;

const inForcePolicy: Account = {
  id: "pol-1",
  name: "Alice Term 20",
  category: "life_insurance",
  subType: "term",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  insuredPerson: "client",
  lifeInsurance: {
    faceValue: 1_000_000,
    costBasis: 0,
    premiumAmount: 2000,
    premiumYears: 20,
    policyType: "term",
    termIssueYear: 2020,
    termLengthYears: 20,
    endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic",
    postPayoutGrowthRate: 0,
    cashValueSchedule: [],
  },
  owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
} as unknown as Account;

describe("buildOwnershipColumn — life insurance", () => {
  it("shows an in-force policy under its trust owner with face value", () => {
    const data: ClientData = { ...baseClient, accounts: [inForcePolicy] } as ClientData;
    const col = buildOwnershipColumn(data, { todayYear: 2026 });

    const ilitGroup = col.groups.find((g) => g.key === "entity:ilit-1");
    expect(ilitGroup).toBeDefined();
    const row = ilitGroup!.assets.find((a) => a.accountId === "pol-1");
    expect(row).toBeDefined();
    expect(row!.value).toBe(1_000_000);
    expect(row!.accountType).toBe("life_insurance");
  });

  it("falls back to cash value when the policy is past term", () => {
    const lapsed: Account = {
      ...inForcePolicy,
      value: 5_000,
      lifeInsurance: {
        ...inForcePolicy.lifeInsurance!,
        termIssueYear: 2000,
        termLengthYears: 10,
      },
    };
    const data: ClientData = { ...baseClient, accounts: [lapsed] } as ClientData;
    const col = buildOwnershipColumn(data, { todayYear: 2026 });

    const ilitGroup = col.groups.find((g) => g.key === "entity:ilit-1");
    const row = ilitGroup!.assets.find((a) => a.accountId === "pol-1");
    expect(row!.value).toBe(5_000);
  });

  it("uses cash value for non-insurance accounts (regression check)", () => {
    const checking: Account = {
      id: "chk-1",
      name: "Checking",
      category: "cash",
      subType: "checking",
      value: 25_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    } as unknown as Account;
    const data: ClientData = { ...baseClient, accounts: [checking] } as ClientData;
    const col = buildOwnershipColumn(data, { todayYear: 2026 });
    const clientGroup = col.groups.find((g) => g.key === "client")!;
    expect(clientGroup.assets[0].value).toBe(25_000);
  });
});
