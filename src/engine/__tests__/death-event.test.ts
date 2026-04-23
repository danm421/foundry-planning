import { describe, it, expect } from "vitest";
import { computeFirstDeathYear, computeFinalDeathYear, identifyDeceased, identifyFinalDeceased, firesAtDeath, distributeUnlinkedLiabilities } from "../death-event";
import type { ClientInfo, WillBequest } from "../types";

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

describe("computeFinalDeathYear", () => {
  const baseClient: ClientInfo = {
    firstName: "T", lastName: "T",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 80,            // dies 2050
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 85,      // dies 2057
  };

  it("returns the later of two assumed deaths for a couple", () => {
    expect(computeFinalDeathYear(baseClient, 2026, 2100)).toBe(2057);
  });

  it("returns the client's death year for a single-filer (no spouseDob)", () => {
    const client: ClientInfo = { ...baseClient, spouseDob: undefined, spouseLifeExpectancy: undefined, filingStatus: "single" };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2050);
  });

  it("returns null when no lifeExpectancy is set", () => {
    const client: ClientInfo = { ...baseClient, lifeExpectancy: undefined };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBeNull();
  });

  it("returns null when the final death falls past planEndYear", () => {
    expect(computeFinalDeathYear(baseClient, 2026, 2050)).toBeNull();
  });

  it("handles same-year double death (both die the same year)", () => {
    const client: ClientInfo = {
      ...baseClient,
      lifeExpectancy: 80,          // dies 2050
      spouseLifeExpectancy: 78,    // dies 2050 (1972 + 78)
    };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2050);
  });

  it("falls back spouseLifeExpectancy=95 when null (matches 4b convention)", () => {
    const client: ClientInfo = { ...baseClient, spouseLifeExpectancy: null };
    // client dies 2050, spouse falls back to 1972 + 95 = 2067
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2067);
  });
});

describe("identifyFinalDeceased", () => {
  const baseClient: ClientInfo = {
    firstName: "T", lastName: "T",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 80,
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 85,
  };

  it("returns the survivor of the first death (client died first → spouse is final)", () => {
    expect(identifyFinalDeceased(baseClient, "client")).toBe("spouse");
  });

  it("returns the survivor of the first death (spouse died first → client is final)", () => {
    expect(identifyFinalDeceased(baseClient, "spouse")).toBe("client");
  });

  it("returns 'client' for a single-filer (firstDeceased === null)", () => {
    expect(identifyFinalDeceased(baseClient, null)).toBe("client");
  });
});

describe("firesAtDeath", () => {
  const mkB = (condition: WillBequest["condition"]): WillBequest => ({
    id: "b1", name: "All assets", assetMode: "all_assets", accountId: null,
    percentage: 100, condition, sortOrder: 0, recipients: [],
  });

  it("fires always-condition at both first and final death", () => {
    expect(firesAtDeath(mkB("always"), 1)).toBe(true);
    expect(firesAtDeath(mkB("always"), 2)).toBe(true);
  });

  it("fires if_spouse_survives at first death only", () => {
    expect(firesAtDeath(mkB("if_spouse_survives"), 1)).toBe(true);
    expect(firesAtDeath(mkB("if_spouse_survives"), 2)).toBe(false);
  });

  it("fires if_spouse_predeceased at final death only", () => {
    expect(firesAtDeath(mkB("if_spouse_predeceased"), 1)).toBe(false);
    expect(firesAtDeath(mkB("if_spouse_predeceased"), 2)).toBe(true);
  });
});

import { splitAccount } from "../death-event";
import type { Account, Liability, DeathTransfer } from "../types";


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

    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", fams, [], [], undefined);
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

    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", fams, [], [], undefined);
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
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", fams, [], [], undefined);
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
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", fams, [], [], undefined);
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
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", fams, [], [], undefined);
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
      will, 1, "spouse", fams, [], [], undefined,
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
      will, 1, "spouse", fams, [], [], undefined,
    );
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });

  it("no-op when the will has no all_assets clause", () => {
    const will: Will = { id: "will-1", grantor: "client", bequests: [] };
    const result = applyWillAllAssetsResidual(cash, 1, false, will, 1, "spouse", fams, [], [], undefined);
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

import { applyIncomeTermination, effectiveFilingStatus } from "../death-event";
import type { Income } from "../types";
import type { FilingStatus } from "../../lib/tax/types";

describe("applyIncomeTermination", () => {
  it("clips deceased-owner incomes at endYear=deathYear", () => {
    const incomes: Income[] = [
      { id: "i-1", type: "salary", name: "John salary", annualAmount: 100000, startYear: 2020, endYear: 2050, growthRate: 0.03, owner: "client" },
      { id: "i-2", type: "salary", name: "Jane salary", annualAmount: 80000, startYear: 2020, endYear: 2050, growthRate: 0.03, owner: "spouse" },
    ];
    const result = applyIncomeTermination(incomes, "client", "spouse", 2045);
    expect(result.find((i) => i.id === "i-1")!.endYear).toBe(2045);
    expect(result.find((i) => i.id === "i-2")!.endYear).toBe(2050); // untouched
  });

  it("retitles joint incomes to survivor (no termination)", () => {
    const incomes: Income[] = [
      { id: "i-j", type: "business", name: "Joint K-1", annualAmount: 50000, startYear: 2020, endYear: 2050, growthRate: 0.03, owner: "joint" },
    ];
    const result = applyIncomeTermination(incomes, "client", "spouse", 2045);
    expect(result[0].owner).toBe("spouse");
    expect(result[0].endYear).toBe(2050);
  });

  it("ignores entity-owned incomes", () => {
    const incomes: Income[] = [
      { id: "i-trust", type: "trust", name: "SLAT distribution", annualAmount: 10000, startYear: 2020, endYear: 2060, growthRate: 0, owner: "client", ownerEntityId: "ent-1" },
    ];
    const result = applyIncomeTermination(incomes, "client", "spouse", 2045);
    expect(result[0].endYear).toBe(2060); // untouched; entity's own story is 4d
  });

  it("lowers endYear only when it was later than deathYear", () => {
    const incomes: Income[] = [
      { id: "i-past", type: "salary", name: "Past contract", annualAmount: 50000, startYear: 2020, endYear: 2030, growthRate: 0, owner: "client" },
    ];
    const result = applyIncomeTermination(incomes, "client", "spouse", 2045);
    expect(result[0].endYear).toBe(2030); // already past; leave alone
  });
});

describe("effectiveFilingStatus", () => {
  it("returns configured status before the death year", () => {
    expect(effectiveFilingStatus("married_joint" as FilingStatus, 2050, 2049)).toBe("married_joint");
  });

  it("returns configured status IN the death year (MFJ for year of death)", () => {
    expect(effectiveFilingStatus("married_joint" as FilingStatus, 2050, 2050)).toBe("married_joint");
  });

  it("returns 'single' from year+1 onward", () => {
    expect(effectiveFilingStatus("married_joint" as FilingStatus, 2050, 2051)).toBe("single");
  });

  it("returns configured status when no death year present", () => {
    expect(effectiveFilingStatus("married_joint" as FilingStatus, null, 2070)).toBe("married_joint");
  });
});

import { applyFirstDeath } from "../death-event";
import type { DeathEventInput, DeathEventResult } from "../death-event";

describe("applyFirstDeath orchestrator", () => {
  const baseAccounts: Account[] = [
    {
      id: "joint-brok",
      name: "Joint Brokerage",
      category: "taxable", subType: "brokerage",
      owner: "joint", value: 400000, basis: 250000,
      growthRate: 0.06, rmdEnabled: false,
    },
    {
      id: "client-ira",
      name: "John IRA",
      category: "retirement", subType: "traditional_ira",
      owner: "client", value: 600000, basis: 0,
      growthRate: 0.07, rmdEnabled: true,
      beneficiaries: [
        { id: "b-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
    },
    {
      id: "client-cash",
      name: "John Savings",
      category: "cash", subType: "savings",
      owner: "client", value: 100000, basis: 100000,
      growthRate: 0.04, rmdEnabled: false,
    },
  ];

  const baseIncomes: Income[] = [
    { id: "inc-salary", type: "salary", name: "John salary", annualAmount: 150000, startYear: 2026, endYear: 2055, growthRate: 0.03, owner: "client" },
  ];

  const fams: FamilyMember[] = [
    { id: "child-a", relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
  ];

  const will: Will = {
    id: "will-john", grantor: "client",
    bequests: [{
      id: "beq-1", name: "Residual to Jane",
      assetMode: "all_assets", accountId: null,
      percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
    }],
  };

  const input: DeathEventInput = {
    year: 2050,
    deceased: "client",
    survivor: "spouse",
    will,
    accounts: baseAccounts,
    accountBalances: { "joint-brok": 400000, "client-ira": 600000, "client-cash": 100000 },
    basisMap: { "joint-brok": 250000, "client-ira": 0, "client-cash": 100000 },
    incomes: baseIncomes,
    liabilities: [],
    familyMembers: fams,
    externalBeneficiaries: [],
    entities: [],
  };

  it("joint account titles to survivor; IRA beneficiary-designates; residual sweeps to spouse", () => {
    const result = applyFirstDeath(input);
    // Joint → spouse via titling (in-place; id preserved)
    const titledJoint = result.accounts.find((a) => a.id === "joint-brok")!;
    expect(titledJoint.owner).toBe("spouse");
    // IRA → child-a via bene designation (100% claimed, in-place mutation)
    const titledIra = result.accounts.find((a) => a.id === "client-ira")!;
    expect(titledIra.ownerFamilyMemberId).toBe("child-a");
    expect(titledIra.beneficiaries).toBeUndefined();
    // Cash → spouse via all_assets residual (in-place, 100%)
    const titledCash = result.accounts.find((a) => a.id === "client-cash")!;
    expect(titledCash.owner).toBe("spouse");
    // Ledger: 3 entries (titling, bene-designation, will)
    expect(result.transfers).toHaveLength(3);
    expect(result.transfers.map((t) => t.via).sort()).toEqual([
      "beneficiary_designation", "titling", "will",
    ]);
    // No fallback fires → no residual_fallback_fired warning
    expect(result.warnings).toEqual([]);
    // Income clipped
    expect(result.incomes[0].endYear).toBe(2050);
  });

  it("emits residual_fallback_fired when a deceased-owned account has no will clause", () => {
    const noResidualWill: Will = { id: "w", grantor: "client", bequests: [] };
    const result = applyFirstDeath({ ...input, will: noResidualWill });
    expect(result.warnings.some((w) => w.startsWith("residual_fallback_fired:"))).toBe(true);
    // Fallback tier 1 routes cash → spouse
    const cashResult = result.transfers.find((t) => t.sourceAccountId === "client-cash")!;
    expect(cashResult.via).toBe("fallback_spouse");
  });

  it("no-op when deceased has no owned accounts (all joint + bene-designated)", () => {
    const narrowAccounts: Account[] = [baseAccounts[0], baseAccounts[1]];
    const narrowInput: DeathEventInput = {
      ...input,
      accounts: narrowAccounts,
      accountBalances: { "joint-brok": 400000, "client-ira": 600000 },
      basisMap: { "joint-brok": 250000, "client-ira": 0 },
    };
    const result = applyFirstDeath(narrowInput);
    expect(result.transfers).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("invariant: sum of transfer amounts matches pre-death deceased-owned balance", () => {
    const result = applyFirstDeath(input);
    const totalLedger = result.transfers.reduce((s, t) => s + t.amount, 0);
    // Joint (400k full passes) + IRA (600k) + cash (100k) = 1.1M.
    // Note: the joint account emits only the deceased's 50%? Spec says:
    // titling passes 100% to survivor — which is the full account value at
    // time of death since the survivor already held the other 50%. So
    // ledger entry records the transferring half... Actually spec says
    // "survivor takes deceased's 50%", but the account itself just flips
    // owner — the transferred AMOUNT is 400000 because that's the full
    // account value. The ledger records 100% of the joint account moving
    // to the survivor (implicit titling completion).
    expect(totalLedger).toBeCloseTo(400000 + 600000 + 100000, 2);
  });

  it("transfer ledger uses accountBalances (grown value), not the Account.value snapshot", () => {
    // Deliberately diverge accountBalances from the accounts' .value snapshots
    // to prove the ledger picks up the grown balance.
    const grownInput: DeathEventInput = {
      ...input,
      accountBalances: {
        "joint-brok": 600000,   // grew from 400k
        "client-ira": 900000,   // grew from 600k
        "client-cash": 120000,  // grew from 100k
      },
      basisMap: {
        "joint-brok": 250000,
        "client-ira": 0,
        "client-cash": 100000,
      },
    };
    const result = applyFirstDeath(grownInput);
    const totalLedger = result.transfers.reduce((s, t) => s + t.amount, 0);
    // Sum should match the grown balances, not the snapshot .value fields.
    expect(totalLedger).toBeCloseTo(600000 + 900000 + 120000, 2);
  });

});

describe("distributeUnlinkedLiabilities", () => {
  const mkTransfer = (
    recipient: { kind: DeathTransfer["recipientKind"]; id: string | null; label: string },
    amount: number,
    resultingAccountId: string | null = "acct-new",
  ): DeathTransfer => ({
    year: 2050, deathOrder: 2, deceased: "client",
    sourceAccountId: "acct-src", sourceAccountName: "Src",
    sourceLiabilityId: null, sourceLiabilityName: null,
    via: "will", recipientKind: recipient.kind,
    recipientId: recipient.id, recipientLabel: recipient.label,
    amount, basis: 0, resultingAccountId, resultingLiabilityId: null,
  });

  const mkLiability = (overrides: Partial<Liability> = {}): Liability => ({
    id: "liab-cc", name: "Credit Card", balance: 10_000,
    interestRate: 0.15, monthlyPayment: 500,
    startYear: 2025, startMonth: 1, termMonths: 24,
    extraPayments: [],
    ...overrides,
  });

  it("returns empty transfers when no unlinked liabilities exist", () => {
    const liabilities = [mkLiability({ linkedPropertyId: "acct-home" })];
    const transfers = [mkTransfer({ kind: "family_member", id: "fm-1", label: "Sarah" }, 50_000)];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities).toEqual(liabilities);
  });

  it("skips entity-owned liabilities (4d territory)", () => {
    const liabilities = [mkLiability({ ownerEntityId: "ent-1" })];
    const transfers = [mkTransfer({ kind: "family_member", id: "fm-1", label: "Sarah" }, 50_000)];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities).toEqual(liabilities);
  });

  it("distributes one unlinked liability proportionally across family-member heirs", () => {
    const liabilities = [mkLiability()];  // $10k CC, unlinked
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 60_000),
      mkTransfer({ kind: "family_member", id: "fm-b", label: "B" }, 40_000),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");

    // fm-a inherits 60% → $6k debt; fm-b inherits 40% → $4k debt
    expect(result.liabilityTransfers).toHaveLength(2);

    const [tA, tB] = result.liabilityTransfers;
    expect(tA.recipientId).toBe("fm-a");
    expect(tA.amount).toBeCloseTo(-6000, 2);
    expect(tA.via).toBe("unlinked_liability_proportional");
    expect(tA.sourceLiabilityId).toBe("liab-cc");
    expect(tA.resultingLiabilityId).toMatch(/^death-liab-/);
    expect(tB.recipientId).toBe("fm-b");
    expect(tB.amount).toBeCloseTo(-4000, 2);

    // Original removed; two new family-member-owned liabilities added.
    expect(result.updatedLiabilities).toHaveLength(2);
    expect(result.updatedLiabilities.find((l) => l.id === "liab-cc")).toBeUndefined();
    const newA = result.updatedLiabilities.find((l) => l.ownerFamilyMemberId === "fm-a");
    expect(newA).toBeDefined();
    expect(newA!.balance).toBeCloseTo(6000, 2);
    expect(newA!.monthlyPayment).toBeCloseTo(300, 2);
    expect(newA!.interestRate).toBe(0.15);
  });

  it("external recipient receives a ledger entry but no new liability row", () => {
    const liabilities = [mkLiability()];
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 50_000),
      mkTransfer({ kind: "external_beneficiary", id: "ext-1", label: "Charity" }, 50_000, null),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");

    expect(result.liabilityTransfers).toHaveLength(2);
    const externalEntry = result.liabilityTransfers.find(
      (t) => t.recipientKind === "external_beneficiary",
    );
    expect(externalEntry).toBeDefined();
    expect(externalEntry!.amount).toBeCloseTo(-5000, 2);
    expect(externalEntry!.resultingLiabilityId).toBeNull();

    // Only one new liability (for the family-member share).
    const newLiabs = result.updatedLiabilities.filter((l) => l.id !== "liab-cc");
    expect(newLiabs).toHaveLength(1);
    expect(newLiabs[0].ownerFamilyMemberId).toBe("fm-a");
  });

  it("system_default recipient gets ledger entry with no new liability", () => {
    const liabilities = [mkLiability({ balance: 4_000, monthlyPayment: 200 })];
    const transfers = [
      mkTransfer({ kind: "system_default", id: null, label: "Other Heirs" }, 100_000, null),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toHaveLength(1);
    expect(result.liabilityTransfers[0].recipientKind).toBe("system_default");
    expect(result.liabilityTransfers[0].amount).toBeCloseTo(-4000, 2);
    expect(result.liabilityTransfers[0].resultingLiabilityId).toBeNull();
    expect(result.updatedLiabilities.filter((l) => l.id !== "liab-cc")).toEqual([]);
  });

  it("zero-estate deceased with unlinked debt drops the debt with a warning", () => {
    const liabilities = [mkLiability()];
    const transfers: DeathTransfer[] = [];  // no asset transfers
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities.filter((l) => l.id === "liab-cc")).toEqual([]);
    expect(result.warnings).toContain("unlinked_liability_no_estate_recipient:liab-cc");
  });

  it("groups multiple transfers to the same recipient into one share", () => {
    const liabilities = [mkLiability()];
    // fm-a appears in 2 asset transfers (different source accounts); combined share = 75%.
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 30_000),
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 45_000),
      mkTransfer({ kind: "family_member", id: "fm-b", label: "B" }, 25_000),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    const aTotal = result.liabilityTransfers
      .filter((t) => t.recipientId === "fm-a")
      .reduce((s, t) => s + t.amount, 0);
    // $10k × 75% = $7,500, as negative
    expect(aTotal).toBeCloseTo(-7500, 2);
  });
});
