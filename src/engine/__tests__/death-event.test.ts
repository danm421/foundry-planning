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
import { applyWillSpecificBequests, applyWillAllAssetsResidual } from "../death-event";
import type { Will, FamilyMember } from "../types";

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

describe("applyWillSpecificBequests (Step 3a)", () => {
  const brokerage: Account = {
    id: "acct-brok", name: "Taxable Brokerage",
    category: "taxable", subType: "brokerage",
    owner: "client", value: 200000, basis: 150000,
    growthRate: 0.06, rmdEnabled: false,
  };
  const fams: FamilyMember[] = [
    { id: "child-a", relationship: "child", firstName: "Alice", lastName: "S", dateOfBirth: null },
    { id: "child-b", relationship: "child", firstName: "Bob", lastName: "S", dateOfBirth: null },
  ];

  it("routes a 100% specific bequest to one family-member recipient", () => {
    const will: Will = {
      id: "will-1",
      grantor: "client",
      bequests: [{
        id: "beq-1", name: "Brokerage to Alice",
        assetMode: "specific", accountId: "acct-brok",
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };

    const result = applyWillSpecificBequests(brokerage, 1, will, "spouse", fams, [], [], undefined);
    expect(result.fractionClaimed).toBeCloseTo(1, 9);
    expect(result.consumed).toBe(true);
    expect(result.ledgerEntries[0]).toMatchObject({
      via: "will", recipientKind: "family_member", recipientId: "child-a", amount: 200000,
    });
  });

  it("splits a 100% bequest across two recipients 50/50", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "Brokerage split",
        assetMode: "specific", accountId: "acct-brok",
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 50, sortOrder: 0 },
          { recipientKind: "family_member", recipientId: "child-b", percentage: 50, sortOrder: 1 },
        ],
      }],
    };

    const result = applyWillSpecificBequests(brokerage, 1, will, "spouse", fams, [], [], undefined);
    expect(result.ledgerEntries).toHaveLength(2);
    expect(result.ledgerEntries[0].amount).toBe(100000);
    expect(result.ledgerEntries[1].amount).toBe(100000);
  });

  it("40% specific bequest leaves 60% to cascade", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "40% to Alice",
        assetMode: "specific", accountId: "acct-brok",
        percentage: 40, condition: "always", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, "spouse", fams, [], [], undefined);
    expect(result.fractionClaimed).toBeCloseTo(0.4, 9);
    expect(result.consumed).toBe(false);
  });

  it("filters bequests by condition at first death", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "Only if spouse predeceased",
        assetMode: "specific", accountId: "acct-brok",
        percentage: 100, condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, "spouse", fams, [], [], undefined);
    expect(result.fractionClaimed).toBe(0);
  });

  it("emits over_allocation_in_will warning when specifics sum >100%", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [
        {
          id: "beq-1", name: "Sixty to A",
          assetMode: "specific", accountId: "acct-brok",
          percentage: 60, condition: "always", sortOrder: 0,
          recipients: [{ recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 }],
        },
        {
          id: "beq-2", name: "Sixty more to B",
          assetMode: "specific", accountId: "acct-brok",
          percentage: 60, condition: "always", sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: "child-b", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, "spouse", fams, [], [], undefined);
    // Pro-rate down: each bequest effectively claims 60/120 of the undisposed remainder.
    expect(result.fractionClaimed).toBeCloseTo(1, 9);
    expect(result.warnings).toContain("over_allocation_in_will:acct-brok");
  });
});

describe("applyWillAllAssetsResidual (Step 3b)", () => {
  const cash: Account = {
    id: "acct-cash", name: "Savings",
    category: "cash", subType: "savings",
    owner: "client", value: 50000, basis: 50000,
    growthRate: 0.04, rmdEnabled: false,
  };

  const fams: FamilyMember[] = [
    { id: "child-a", relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null },
  ];

  it("sweeps residual when no specific clause touched this account", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "All other assets",
        assetMode: "all_assets", accountId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };

    const result = applyWillAllAssetsResidual(
      cash,
      /* undisposedFraction */ 1,
      /* accountTouchedBySpecific */ false,
      will, "spouse", fams, [], [], undefined,
    );
    expect(result.consumed).toBe(true);
    expect(result.fractionClaimed).toBe(1);
    expect(result.ledgerEntries[0]).toMatchObject({
      recipientKind: "spouse", via: "will",
    });
  });

  it("does NOT fire when a specific clause claimed any portion", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "All other assets",
        assetMode: "all_assets", accountId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };
    const result = applyWillAllAssetsResidual(
      cash, 0.6, /* accountTouchedBySpecific */ true,
      will, "spouse", fams, [], [], undefined,
    );
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });

  it("no-op when the will has no all_assets clause", () => {
    const will: Will = { id: "will-1", grantor: "client", bequests: [] };
    const result = applyWillAllAssetsResidual(cash, 1, false, will, "spouse", fams, [], [], undefined);
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });
});

import { applyFallback } from "../death-event";

describe("applyFallback (Step 4)", () => {
  const source: Account = {
    id: "acct-x", name: "Leftover",
    category: "taxable", subType: "brokerage",
    owner: "client", value: 100000, basis: 80000,
    growthRate: 0.05, rmdEnabled: false,
  };

  it("tier 1: survivor exists → residual to spouse, with warning", () => {
    const result = applyFallback(source, 1, "spouse", [], undefined);
    expect(result.step.ledgerEntries[0]).toMatchObject({
      via: "fallback_spouse", recipientKind: "spouse", amount: 100000,
    });
    expect(result.warnings).toContain("residual_fallback_fired:acct-x");
  });

  it("tier 2: no survivor → even split among living children", () => {
    const kids: FamilyMember[] = [
      { id: "c1", relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null },
      { id: "c2", relationship: "child", firstName: "Bob", lastName: null, dateOfBirth: null },
    ];
    const result = applyFallback(source, 1, null, kids, undefined);
    expect(result.step.ledgerEntries).toHaveLength(2);
    expect(result.step.ledgerEntries[0].amount).toBe(50000);
    expect(result.step.ledgerEntries[0].via).toBe("fallback_children");
  });

  it("tier 3: no survivor, no children → Other Heirs sink", () => {
    const result = applyFallback(source, 1, null, [], undefined);
    expect(result.step.ledgerEntries).toHaveLength(1);
    expect(result.step.ledgerEntries[0]).toMatchObject({
      via: "fallback_other_heirs",
      recipientKind: "system_default",
      recipientId: null,
      recipientLabel: "Other Heirs",
      resultingAccountId: null,
    });
    expect(result.step.resultingAccounts).toHaveLength(0);
  });

  it("no-op when undisposedFraction is ~0", () => {
    const result = applyFallback(source, 1e-12, "spouse", [], undefined);
    expect(result.step.ledgerEntries).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
