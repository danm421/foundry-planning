import { describe, it, expect } from "vitest";
import { computeFirstDeathYear, identifyDeceased } from "../death-event";
import type { ClientInfo } from "../types";

describe("computeFirstDeathYear", () => {
  const baseClient: ClientInfo = {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    lifeExpectancy: 85,
    filingStatus: "married_joint",
  };

  it("returns the earlier of client / spouse death years", () => {
    // Client: 1970 + 85 = 2055; spouse: 1972 + 80 = 2052. Spouse dies first.
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2052);
  });

  it("uses 95 as spouse default when spouseLifeExpectancy is null", () => {
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: null,
    };
    // Client 1970+85=2055, spouse 1972+95=2067. Client dies first.
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2055);
  });

  it("returns null when no spouse", () => {
    expect(computeFirstDeathYear(baseClient, 2026, 2100)).toBeNull();
  });

  it("returns null when the computed year falls outside the plan horizon", () => {
    const client: ClientInfo = {
      ...baseClient,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    // Spouse dies 2052; plan ends 2040 → no death event within horizon.
    expect(computeFirstDeathYear(client, 2026, 2040)).toBeNull();
  });

  it("returns null when client has no lifeExpectancy set", () => {
    const client: ClientInfo = {
      ...baseClient,
      lifeExpectancy: undefined,
      spouseDob: "1972-06-15",
      spouseLifeExpectancy: 80,
    };
    expect(computeFirstDeathYear(client, 2026, 2100)).toBeNull();
  });

  it("deterministic tiebreaker: client first when both die same year", () => {
    const client: ClientInfo = {
      ...baseClient,
      dateOfBirth: "1970-01-01",
      lifeExpectancy: 80,
      spouseDob: "1970-01-01",
      spouseLifeExpectancy: 80,
    };
    // Both 2050. Documented convention: client dies first.
    expect(computeFirstDeathYear(client, 2026, 2100)).toBe(2050);
  });
});

describe("identifyDeceased", () => {
  const baseClient: ClientInfo = {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    lifeExpectancy: 85,
    filingStatus: "married_joint",
  };

  it("returns 'client' when client dies strictly before spouse", () => {
    // Client 1970+80=2050; spouse 1972+85=2057. Client first.
    const client: ClientInfo = { ...baseClient, lifeExpectancy: 80, spouseDob: "1972-06-15", spouseLifeExpectancy: 85 };
    expect(identifyDeceased(client, 2050)).toBe("client");
  });

  it("returns 'spouse' when spouse dies strictly before client", () => {
    // Client 1970+85=2055; spouse 1972+80=2052. Spouse first.
    const client: ClientInfo = { ...baseClient, lifeExpectancy: 85, spouseDob: "1972-06-15", spouseLifeExpectancy: 80 };
    expect(identifyDeceased(client, 2052)).toBe("spouse");
  });

  it("returns 'client' on the same-year tiebreaker (matches computeFirstDeathYear convention)", () => {
    // Client 1970+80=2050; spouse 1970+80=2050. Tiebreaker: client first.
    const client: ClientInfo = { ...baseClient, dateOfBirth: "1970-01-01", lifeExpectancy: 80, spouseDob: "1970-01-01", spouseLifeExpectancy: 80 };
    expect(identifyDeceased(client, 2050)).toBe("client");
  });
});

import { splitAccount } from "../death-event";
import type { Account, Liability } from "../types";


describe("splitAccount", () => {
  const brokerage: Account = {
    id: "acct-brokerage",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owner: "joint",
    value: 300000,
    basis: 200000,
    growthRate: 0.06,
    rmdEnabled: false,
  };

  it("returns a single in-place mutation when one share takes 100%", () => {
    const result = splitAccount(brokerage, [
      { fraction: 1.0, ownerMutation: { owner: "spouse" }, ledgerMeta: { recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse", via: "titling" } },
    ], undefined);

    expect(result.resultingAccounts).toHaveLength(1);
    expect(result.resultingAccounts[0].id).toBe("acct-brokerage"); // no rename
    expect(result.resultingAccounts[0].owner).toBe("spouse");
    expect(result.resultingAccounts[0].value).toBe(300000);
    expect(result.resultingAccounts[0].basis).toBe(200000);
    expect(result.resultingLiabilities).toHaveLength(0);
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0]).toMatchObject({
      recipientKind: "spouse",
      via: "titling",
      amount: 300000,
      basis: 200000,
      resultingAccountId: "acct-brokerage",
    });
  });

  it("splits 50/50 across two recipients with proportional balance + basis", () => {
    const result = splitAccount(brokerage, [
      { fraction: 0.5, ownerMutation: { ownerFamilyMemberId: "child-a" }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-a", recipientLabel: "Child A", via: "will" } },
      { fraction: 0.5, ownerMutation: { ownerFamilyMemberId: "child-b" }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-b", recipientLabel: "Child B", via: "will" } },
    ], undefined);

    expect(result.resultingAccounts).toHaveLength(2);
    // Synthetic ids, new names prefixed:
    expect(result.resultingAccounts[0].id).not.toBe("acct-brokerage");
    expect(result.resultingAccounts[0].name).toBe("Joint Brokerage — to Child A");
    expect(result.resultingAccounts[0].value).toBe(150000);
    expect(result.resultingAccounts[0].basis).toBe(100000);
    expect(result.resultingAccounts[0].ownerFamilyMemberId).toBe("child-a");
    expect(result.resultingAccounts[1].name).toBe("Joint Brokerage — to Child B");
    expect(result.resultingAccounts[1].value).toBe(150000);
    expect(result.ledgerEntries).toHaveLength(2);
  });

  it("removes the account (no resulting row) for out-of-household recipients", () => {
    const result = splitAccount(brokerage, [
      { fraction: 1.0, removed: true, ledgerMeta: { recipientKind: "external_beneficiary", recipientId: "charity-1", recipientLabel: "Community Foundation", via: "will" } },
    ], undefined);

    expect(result.resultingAccounts).toHaveLength(0);
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0].resultingAccountId).toBeNull();
    expect(result.ledgerEntries[0].amount).toBe(300000);
  });

  it("splits a linked liability proportionally when the account splits", () => {
    const home: Account = { ...brokerage, id: "acct-home", name: "Primary Home", category: "real_estate", value: 800000, basis: 500000 };
    const mortgage: Liability = {
      id: "liab-mortgage",
      name: "Primary Mortgage",
      balance: 300000,
      interestRate: 0.06,
      monthlyPayment: 2000,
      startYear: 2020,
      startMonth: 1,
      termMonths: 360,
      linkedPropertyId: "acct-home",
      extraPayments: [],
    };

    const result = splitAccount(home, [
      { fraction: 0.6, ownerMutation: { owner: "spouse" }, ledgerMeta: { recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse", via: "will" } },
      { fraction: 0.4, ownerMutation: { ownerFamilyMemberId: "child-a" }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-a", recipientLabel: "Child A", via: "will" } },
    ], mortgage);

    expect(result.resultingLiabilities).toHaveLength(2);
    expect(result.resultingLiabilities[0].balance).toBeCloseTo(180000, 2);
    expect(result.resultingLiabilities[0].monthlyPayment).toBeCloseTo(1200, 2);
    expect(result.resultingLiabilities[0].linkedPropertyId).toBe(result.resultingAccounts[0].id);
    expect(result.resultingLiabilities[1].balance).toBeCloseTo(120000, 2);
    expect(result.resultingLiabilities[1].linkedPropertyId).toBe(result.resultingAccounts[1].id);
  });

  it("removes a linked liability when the account is removed (debts follow assets)", () => {
    const home: Account = { ...brokerage, id: "acct-home", name: "Primary Home" };
    const mortgage: Liability = { id: "liab-m", name: "Mortgage", balance: 100000, interestRate: 0.05, monthlyPayment: 600, startYear: 2020, startMonth: 1, termMonths: 360, linkedPropertyId: "acct-home", extraPayments: [] };
    const result = splitAccount(home, [
      { fraction: 1.0, removed: true, ledgerMeta: { recipientKind: "external_beneficiary", recipientId: "charity-1", recipientLabel: "Charity", via: "will" } },
    ], mortgage);
    expect(result.resultingLiabilities).toHaveLength(0);
  });

  it("throws when any share has fraction <= 0 (enforces JSDoc contract)", () => {
    expect(() =>
      splitAccount(brokerage, [
        { fraction: 1.0, ownerMutation: { owner: "spouse" }, ledgerMeta: { via: "titling", recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse" } },
        { fraction: 0, removed: true, ledgerMeta: { via: "will", recipientKind: "external_beneficiary", recipientId: null, recipientLabel: "X" } },
      ], undefined),
    ).toThrow(/share fraction must be > 0/);
  });
});

import { applyTitling } from "../death-event";

describe("applyTitling (Step 1)", () => {
  const joint: Account = {
    id: "acct-joint",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owner: "joint",
    value: 400000,
    basis: 250000,
    growthRate: 0.06,
    rmdEnabled: false,
  };

  const soloClient: Account = { ...joint, id: "acct-solo", name: "Client Solo", owner: "client" };

  it("flips joint → survivor, emits single titling ledger entry", () => {
    const result = applyTitling(joint, "spouse", undefined);
    expect(result.consumed).toBe(true);
    expect(result.resultingAccounts[0].owner).toBe("spouse");
    expect(result.resultingAccounts[0].id).toBe("acct-joint"); // in-place
    expect(result.ledgerEntries[0]).toMatchObject({
      via: "titling",
      recipientKind: "spouse",
      amount: 400000,
    });
  });

  it("no-op for non-joint accounts", () => {
    const result = applyTitling(soloClient, "spouse", undefined);
    expect(result.consumed).toBe(false);
    expect(result.resultingAccounts).toHaveLength(0);
    expect(result.ledgerEntries).toHaveLength(0);
  });
});

import { applyBeneficiaryDesignations } from "../death-event";
import type { BeneficiaryRef } from "../types";

describe("applyBeneficiaryDesignations (Step 2)", () => {
  const ira: Account = {
    id: "acct-ira",
    name: "John Traditional IRA",
    category: "retirement",
    subType: "traditional_ira",
    owner: "client",
    value: 500000,
    basis: 0,
    growthRate: 0.07,
    rmdEnabled: true,
  };

  it("routes 100% to primaries when they sum to 100", () => {
    const iraWithBens: Account = {
      ...ira,
      beneficiaries: [
        { id: "ben-1", tier: "primary", percentage: 60, familyMemberId: "child-a", sortOrder: 0 },
        { id: "ben-2", tier: "primary", percentage: 40, familyMemberId: "child-b", sortOrder: 1 },
      ],
    };

    const result = applyBeneficiaryDesignations(
      iraWithBens,
      /* undisposedFraction */ 1,
      /* familyMembers */ [
        { id: "child-a", relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
        { id: "child-b", relationship: "child", firstName: "Bob", lastName: "Smith", dateOfBirth: "2002-01-01" },
      ],
      /* externals */ [],
      undefined,
    );

    expect(result.consumed).toBe(true);
    expect(result.fractionClaimed).toBeCloseTo(1, 9);
    expect(result.ledgerEntries).toHaveLength(2);
    expect(result.ledgerEntries[0]).toMatchObject({
      via: "beneficiary_designation",
      recipientKind: "family_member",
      recipientId: "child-a",
      amount: 300000,
    });
    expect(result.ledgerEntries[1].amount).toBe(200000);
  });

  it("leaves residual to cascade when primaries sum < 100", () => {
    const iraWithBens: Account = {
      ...ira,
      beneficiaries: [
        { id: "ben-1", tier: "primary", percentage: 70, familyMemberId: "child-a", sortOrder: 0 },
      ],
    };

    const result = applyBeneficiaryDesignations(
      iraWithBens, 1,
      [{ id: "child-a", relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null }],
      [], undefined,
    );

    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBeCloseTo(0.7, 9);
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0].amount).toBe(350000);
    expect(result.resultingAccounts).toHaveLength(1); // synthetic for child-a's 70%
  });

  it("no-op when no beneficiaries are set (solo-owned non-retirement)", () => {
    const result = applyBeneficiaryDesignations(ira, 1, [], [], undefined);
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });

  it("skips contingent tier in v1", () => {
    const iraBothTiers: Account = {
      ...ira,
      beneficiaries: [
        { id: "ben-1", tier: "primary", percentage: 50, familyMemberId: "child-a", sortOrder: 0 },
        { id: "ben-2", tier: "contingent", percentage: 100, familyMemberId: "child-b", sortOrder: 0 },
      ],
    };
    const result = applyBeneficiaryDesignations(
      iraBothTiers, 1,
      [
        { id: "child-a", relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
        { id: "child-b", relationship: "child", firstName: "B", lastName: null, dateOfBirth: null },
      ],
      [], undefined,
    );
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.ledgerEntries[0].recipientId).toBe("child-a");
    expect(result.fractionClaimed).toBeCloseTo(0.5, 9);
  });
});
