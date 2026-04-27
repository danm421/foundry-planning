import { describe, it, expect } from "vitest";
import { computeFirstDeathYear, computeFinalDeathYear, identifyDeceased, identifyFinalDeceased, firesAtDeath, distributeUnlinkedLiabilities } from "../death-event";
import type { ClientInfo, WillBequest } from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, controllingFamilyMember, controllingEntity } from "../ownership";

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
    id: "b1", name: "All assets", kind: "asset", assetMode: "all_assets", accountId: null,
    liabilityId: null, percentage: 100, condition, sortOrder: 0, recipients: [],
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
import type { Account, Liability, DeathTransfer, EntitySummary } from "../types";


describe("splitAccount", () => {
  const brokerage: Account = {
    id: "acct-brokerage",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    value: 300000,
    basis: 200000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  };

  it("returns a single in-place mutation when one share takes 100%", () => {
    const result = splitAccount(brokerage, [
      { fraction: 1.0, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }] }, ledgerMeta: { recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse", via: "titling" } },
    ], undefined);

    expect(result.resultingAccounts).toHaveLength(1);
    expect(result.resultingAccounts[0].id).toBe("acct-brokerage"); // no rename
    expect(controllingFamilyMember(result.resultingAccounts[0])).toBe(LEGACY_FM_SPOUSE);
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
      { fraction: 0.5, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: "child-a", percent: 1 }] }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-a", recipientLabel: "Child A", via: "will" } },
      { fraction: 0.5, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: "child-b", percent: 1 }] }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-b", recipientLabel: "Child B", via: "will" } },
    ], undefined);

    expect(result.resultingAccounts).toHaveLength(2);
    // Synthetic ids, new names prefixed:
    expect(result.resultingAccounts[0].id).not.toBe("acct-brokerage");
    expect(result.resultingAccounts[0].name).toBe("Joint Brokerage — to Child A");
    expect(result.resultingAccounts[0].value).toBe(150000);
    expect(result.resultingAccounts[0].basis).toBe(100000);
    expect(controllingFamilyMember(result.resultingAccounts[0])).toBe("child-a");
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
      owners: [],
    };

    const result = splitAccount(home, [
      { fraction: 0.6, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }] }, ledgerMeta: { recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse", via: "will" } },
      { fraction: 0.4, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: "child-a", percent: 1 }] }, ledgerMeta: { recipientKind: "family_member", recipientId: "child-a", recipientLabel: "Child A", via: "will" } },
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
    const mortgage: Liability = { id: "liab-m", name: "Mortgage", balance: 100000, interestRate: 0.05, monthlyPayment: 600, startYear: 2020, startMonth: 1, termMonths: 360, linkedPropertyId: "acct-home", extraPayments: [], owners: [] };
    const result = splitAccount(home, [
      { fraction: 1.0, removed: true, ledgerMeta: { recipientKind: "external_beneficiary", recipientId: "charity-1", recipientLabel: "Charity", via: "will" } },
    ], mortgage);
    expect(result.resultingLiabilities).toHaveLength(0);
  });

  it("throws when any share has fraction <= 0 (enforces JSDoc contract)", () => {
    expect(() =>
      splitAccount(brokerage, [
        { fraction: 1.0, ownerMutation: { owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }] }, ledgerMeta: { via: "titling", recipientKind: "spouse", recipientId: null, recipientLabel: "Spouse" } },
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
    value: 400000,
    basis: 250000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  };

  const soloClient: Account = {
    ...joint,
    id: "acct-solo",
    name: "Client Solo",
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  it("flips joint → survivor, emits single titling ledger entry", () => {
    const result = applyTitling(joint, "spouse", undefined, LEGACY_FM_SPOUSE);
    expect(result.consumed).toBe(true);
    expect(controllingFamilyMember(result.resultingAccounts[0])).toBe(LEGACY_FM_SPOUSE);
    expect(result.resultingAccounts[0].id).toBe("acct-joint"); // in-place
    expect(result.ledgerEntries[0]).toMatchObject({
      via: "titling",
      recipientKind: "spouse",
      amount: 400000,
    });
  });

  it("no-op for non-joint accounts", () => {
    const result = applyTitling(soloClient, "spouse", undefined, LEGACY_FM_SPOUSE);
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
    value: 500000,
    basis: 0,
    growthRate: 0.07,
    rmdEnabled: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
        { id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
        { id: "child-b", role: "child" as const, relationship: "child", firstName: "Bob", lastName: "Smith", dateOfBirth: "2002-01-01" },
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
      [{ id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null }],
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
        { id: "child-a", role: "child" as const, relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
        { id: "child-b", role: "child" as const, relationship: "child", firstName: "B", lastName: null, dateOfBirth: null },
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
    value: 200000, basis: 150000,
    growthRate: 0.06, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
  const fams: FamilyMember[] = [
    { id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "S", dateOfBirth: null },
    { id: "child-b", role: "child" as const, relationship: "child", firstName: "Bob", lastName: "S", dateOfBirth: null },
  ];

  it("routes a 100% specific bequest to one family-member recipient", () => {
    const will: Will = {
      id: "will-1",
      grantor: "client",
      bequests: [{
        id: "beq-1", name: "Brokerage to Alice",
        kind: "asset", assetMode: "specific", accountId: "acct-brok", liabilityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };

    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
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
        kind: "asset", assetMode: "specific", accountId: "acct-brok", liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 50, sortOrder: 0 },
          { recipientKind: "family_member", recipientId: "child-b", percentage: 50, sortOrder: 1 },
        ],
      }],
    };

    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
    expect(result.ledgerEntries).toHaveLength(2);
    expect(result.ledgerEntries[0].amount).toBe(100000);
    expect(result.ledgerEntries[1].amount).toBe(100000);
  });

  it("40% specific bequest leaves 60% to cascade", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "40% to Alice",
        kind: "asset", assetMode: "specific", accountId: "acct-brok", liabilityId: null,
        percentage: 40, condition: "always", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
    expect(result.fractionClaimed).toBeCloseTo(0.4, 9);
    expect(result.consumed).toBe(false);
  });

  it("filters bequests by condition at first death", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "Only if spouse predeceased",
        kind: "asset", assetMode: "specific", accountId: "acct-brok", liabilityId: null,
        percentage: 100, condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 },
        ],
      }],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
    expect(result.fractionClaimed).toBe(0);
  });

  it("emits over_allocation_in_will warning when specifics sum >100%", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [
        {
          id: "beq-1", name: "Sixty to A",
          kind: "asset" as const, assetMode: "specific" as const, accountId: "acct-brok", liabilityId: null,
          percentage: 60, condition: "always" as const, sortOrder: 0,
          recipients: [{ recipientKind: "family_member" as const, recipientId: "child-a", percentage: 100, sortOrder: 0 }],
        },
        {
          id: "beq-2", name: "Sixty more to B",
          kind: "asset" as const, assetMode: "specific" as const, accountId: "acct-brok", liabilityId: null,
          percentage: 60, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member" as const, recipientId: "child-b", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const result = applyWillSpecificBequests(brokerage, 1, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
    // Pro-rate down: each bequest effectively claims 60/120 of the undisposed remainder.
    expect(result.fractionClaimed).toBeCloseTo(1, 9);
    expect(result.warnings).toContain("over_allocation_in_will:acct-brok");
  });
});

describe("applyWillAllAssetsResidual (Step 3b)", () => {
  const cash: Account = {
    id: "acct-cash", name: "Savings",
    category: "cash", subType: "savings",
    value: 50000, basis: 50000,
    growthRate: 0.04, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  const fams: FamilyMember[] = [
    { id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null },
  ];

  it("sweeps residual when no specific clause touched this account", () => {
    const will: Will = {
      id: "will-1", grantor: "client",
      bequests: [{
        id: "beq-1", name: "All other assets",
        kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };

    const result = applyWillAllAssetsResidual(
      cash,
      /* undisposedFraction */ 1,
      /* accountTouchedBySpecific */ false,
      will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined,
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
        kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };
    const result = applyWillAllAssetsResidual(
      cash, 0.6, /* accountTouchedBySpecific */ true,
      will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined,
    );
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });

  it("no-op when the will has no all_assets clause", () => {
    const will: Will = { id: "will-1", grantor: "client", bequests: [] };
    const result = applyWillAllAssetsResidual(cash, 1, false, will, 1, "spouse", LEGACY_FM_SPOUSE, fams, [], [], undefined);
    expect(result.consumed).toBe(false);
    expect(result.fractionClaimed).toBe(0);
  });
});

import { applyFallback } from "../death-event";

describe("applyFallback (Step 4)", () => {
  const source: Account = {
    id: "acct-x", name: "Leftover",
    category: "taxable", subType: "brokerage",
    value: 100000, basis: 80000,
    growthRate: 0.05, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  it("tier 1: survivor exists → residual to spouse, with warning", () => {
    const result = applyFallback(source, 1, "spouse", LEGACY_FM_SPOUSE, [], undefined);
    expect(result.step.ledgerEntries[0]).toMatchObject({
      via: "fallback_spouse", recipientKind: "spouse", amount: 100000,
    });
    expect(result.warnings).toContain("residual_fallback_fired:acct-x");
  });

  it("tier 2: no survivor → even split among living children", () => {
    const kids: FamilyMember[] = [
      { id: "c1", role: "child" as const, relationship: "child", firstName: "Alice", lastName: null, dateOfBirth: null },
      { id: "c2", role: "child" as const, relationship: "child", firstName: "Bob", lastName: null, dateOfBirth: null },
    ];
    const result = applyFallback(source, 1, null, null, kids, undefined);
    expect(result.step.ledgerEntries).toHaveLength(2);
    expect(result.step.ledgerEntries[0].amount).toBe(50000);
    expect(result.step.ledgerEntries[0].via).toBe("fallback_children");
  });

  it("tier 3: no survivor, no children → Other Heirs sink", () => {
    const result = applyFallback(source, 1, null, null, [], undefined);
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
    const result = applyFallback(source, 1e-12, "spouse", LEGACY_FM_SPOUSE, [], undefined);
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

import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type { DeathEventInput, DeathEventResult } from "../death-event";

describe("applyFirstDeath orchestrator", () => {
  const baseAccounts: Account[] = [
    {
      id: "joint-brok",
      name: "Joint Brokerage",
      category: "taxable", subType: "brokerage",
      value: 400000, basis: 250000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
      ],
    },
    {
      id: "client-ira",
      name: "John IRA",
      category: "retirement", subType: "traditional_ira",
      value: 600000, basis: 0,
      growthRate: 0.07, rmdEnabled: true,
      beneficiaries: [
        { id: "b-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    },
    {
      id: "client-cash",
      name: "John Savings",
      category: "cash", subType: "savings",
      value: 100000, basis: 100000,
      growthRate: 0.04, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    },
  ];

  const baseIncomes: Income[] = [
    { id: "inc-salary", type: "salary", name: "John salary", annualAmount: 150000, startYear: 2026, endYear: 2055, growthRate: 0.03, owner: "client" },
  ];

  const fams: FamilyMember[] = [
    { id: "fm-client", role: "client" as const, relationship: "other", firstName: "John", lastName: "Smith", dateOfBirth: "1970-01-01" },
    { id: "fm-spouse", role: "spouse" as const, relationship: "other", firstName: "Jane", lastName: "Smith", dateOfBirth: "1972-06-15" },
    { id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
  ];

  const will: Will = {
    id: "will-john", grantor: "client",
    bequests: [{
      id: "beq-1", name: "Residual to Jane",
      kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null,
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
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2080,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
  };

  it("joint account titles to survivor; IRA beneficiary-designates; residual sweeps to spouse", () => {
    const result = applyFirstDeath(input);
    // Joint → spouse via titling (in-place; id preserved)
    const titledJoint = result.accounts.find((a) => a.id === "joint-brok")!;
    expect(controllingFamilyMember(titledJoint)).toBe("fm-spouse");
    // IRA → child-a via bene designation (100% claimed, in-place mutation)
    const titledIra = result.accounts.find((a) => a.id === "client-ira")!;
    expect(controllingFamilyMember(titledIra)).toBe("child-a");
    expect(titledIra.beneficiaries).toBeUndefined();
    // Cash → spouse via all_assets residual (in-place, 100%)
    const titledCash = result.accounts.find((a) => a.id === "client-cash")!;
    expect(controllingFamilyMember(titledCash)).toBe("fm-spouse");
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

  it("step-up: joint taxable brokerage → survivor's basisMap = (FMV + originalBasis) / 2", () => {
    // joint-brok: balance $400k, originalBasis $250k → stepped basis = $325k
    const result = applyFirstDeath(input);
    expect(result.basisMap["joint-brok"]).toBeCloseTo(325_000, 2);
  });

  it("step-up: single-owner cash → survivor receives basis = FMV (idempotent: basis==value)", () => {
    const result = applyFirstDeath(input);
    // client-cash: balance $100k, originalBasis $100k → stepped $100k
    expect(result.basisMap["client-cash"]).toBeCloseTo(100_000, 2);
  });

  it("step-up: single-owner traditional IRA → heir's basis unchanged (IRD)", () => {
    const result = applyFirstDeath(input);
    // client-ira: balance $600k, originalBasis $0 → stepped $0 (no IRD step-up)
    expect(result.basisMap["client-ira"]).toBeCloseTo(0, 2);
  });

  it("step-up: grown joint taxable → step-up uses current FMV, not plan-start .value", () => {
    // Prove step-up reads from accountBalances (grown) not Account.value snapshot.
    const grownInput: DeathEventInput = {
      ...input,
      accountBalances: {
        "joint-brok": 600_000,     // grew from 400k
        "client-ira": 900_000,
        "client-cash": 120_000,
      },
      basisMap: {
        "joint-brok": 250_000,
        "client-ira": 0,
        "client-cash": 100_000,
      },
    };
    const result = applyFirstDeath(grownInput);
    // Stepped basis = (600k + 250k) / 2 = 425k
    expect(result.basisMap["joint-brok"]).toBeCloseTo(425_000, 2);
  });

  it("step-up: joint real-estate → half step-up using current FMV", () => {
    const joint_re: Account = {
      id: "joint-home", name: "Home",
      category: "real_estate", subType: "primary_residence",
      value: 800_000, basis: 300_000,
      growthRate: 0.04, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
      ],
    };
    const homeInput: DeathEventInput = {
      ...input,
      accounts: [joint_re, baseAccounts[1]], // home + IRA only
      accountBalances: { "joint-home": 800_000, "client-ira": 600_000 },
      basisMap: { "joint-home": 300_000, "client-ira": 0 },
    };
    const result = applyFirstDeath(homeInput);
    // Stepped basis = (800k + 300k) / 2 = 550k
    expect(result.basisMap["joint-home"]).toBeCloseTo(550_000, 2);
  });

  it("step-up: single-owner taxable bequeathed to heir → full step-up in split accounts", () => {
    const brok: Account = {
      id: "client-brok", name: "John Brokerage",
      category: "taxable", subType: "brokerage",
      value: 500_000, basis: 200_000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    };
    const willToChild: Will = {
      id: "w", grantor: "client",
      bequests: [{
        id: "b1", name: "All to Alice",
        kind: "asset", assetMode: "all_assets",
        accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 }],
      }],
    };
    const bequestInput: DeathEventInput = {
      ...input,
      will: willToChild,
      accounts: [brok],
      accountBalances: { "client-brok": 500_000 },
      basisMap: { "client-brok": 200_000 },
    };
    const result = applyFirstDeath(bequestInput);
    // The resulting account may have a synthetic id (non in-place split) or keep "client-brok" (in-place).
    // Either way, exactly one account should exist with the stepped-up basis = FMV = 500k.
    const heirAccounts = result.accounts.filter((a) => controllingFamilyMember(a) === "child-a");
    expect(heirAccounts).toHaveLength(1);
    expect(result.basisMap[heirAccounts[0].id]).toBeCloseTo(500_000, 2);
  });

  it("step-up: revocable-trust taxable account pours out with FMV basis per beneficiary share", () => {
    const revTrust: EntitySummary = {
      id: "rev-trust-1", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: false,
      grantor: "client",
      beneficiaries: [
        { id: "bref-1", tier: "primary", percentage: 60, familyMemberId: "child-a", sortOrder: 0 },
        { id: "bref-2", tier: "primary", percentage: 40, familyMemberId: "child-b", sortOrder: 1 },
      ],
    };
    const trustBrok: Account = {
      id: "rev-brok", name: "Revocable Trust Brokerage",
      category: "taxable", subType: "brokerage",
      value: 1_000_000, basis: 400_000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "rev-trust-1", percent: 1 }],
    };
    const fams2: FamilyMember[] = [
      { id: "fm-client", role: "client" as const, relationship: "other", firstName: "John", lastName: "Smith", dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse" as const, relationship: "other", firstName: "Jane", lastName: "Smith", dateOfBirth: "1972-06-15" },
      { id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
      { id: "child-b", role: "child" as const, relationship: "child", firstName: "Bob",   lastName: "Smith", dateOfBirth: "2002-01-01" },
    ];
    const trustInput: DeathEventInput = {
      ...input,
      accounts: [trustBrok],
      accountBalances: { "rev-brok": 1_000_000 },
      basisMap: { "rev-brok": 400_000 },
      familyMembers: fams2,
      entities: [revTrust],
    };
    const result = applyFirstDeath(trustInput);
    const pourOutTransfers = result.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pourOutTransfers).toHaveLength(2);
    // Full step-up: each transfer's basis = FMV × percentage
    const aliceT = pourOutTransfers.find((t) => t.recipientId === "child-a")!;
    const bobT   = pourOutTransfers.find((t) => t.recipientId === "child-b")!;
    expect(aliceT.basis).toBeCloseTo(600_000, 2); // 60% of $1M
    expect(bobT.basis).toBeCloseTo(400_000, 2);   // 40% of $1M
  });

  it("step-up: revocable-trust IRA pours out with original basis (IRD — no step-up)", () => {
    const revTrust: EntitySummary = {
      id: "rev-trust-2", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: false,
      grantor: "client",
      beneficiaries: [
        { id: "bref-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
    };
    const trustIra: Account = {
      id: "rev-ira", name: "Trust-Owned IRA",
      category: "retirement", subType: "traditional_ira",
      value: 500_000, basis: 50_000,
      growthRate: 0.07, rmdEnabled: true,
      owners: [{ kind: "entity", entityId: "rev-trust-2", percent: 1 }],
    };
    const trustInput: DeathEventInput = {
      ...input,
      accounts: [trustIra],
      accountBalances: { "rev-ira": 500_000 },
      basisMap: { "rev-ira": 50_000 },
      entities: [revTrust],
    };
    const result = applyFirstDeath(trustInput);
    const pourOutTransfers = result.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pourOutTransfers).toHaveLength(1);
    // IRD rule: basis stays at original $50k (not stepped to FMV $500k)
    expect(pourOutTransfers[0].basis).toBeCloseTo(50_000, 2);
  });

  it("step-up: irrevocable trust (ILIT/SLAT/IDGT) never touched — basisMap unchanged (regression guard)", () => {
    const ilit: EntitySummary = {
      id: "ilit-1", includeInPortfolio: true,
      isGrantor: false, isIrrevocable: true,
      grantor: "client",
      beneficiaries: [
        { id: "bref-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
    };
    const trustBrok: Account = {
      id: "ilit-brok", name: "ILIT Brokerage",
      category: "taxable", subType: "brokerage",
      value: 2_000_000, basis: 500_000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
    };
    const trustInput: DeathEventInput = {
      ...input,
      accounts: [trustBrok],
      accountBalances: { "ilit-brok": 2_000_000 },
      basisMap: { "ilit-brok": 500_000 },
      entities: [ilit],
    };
    const result = applyFirstDeath(trustInput);
    // Irrevocable trusts don't pour out; account stays inside the trust with
    // unchanged basis.
    expect(result.basisMap["ilit-brok"]).toBeCloseTo(500_000, 2);
    expect(result.transfers.filter((t) => t.via === "trust_pour_out")).toHaveLength(0);
  });

  it("returns mutated entities reflecting grantor-flip when an IDGT's grantor dies", () => {
    // IDGT — irrevocable + isGrantor=true + grantor=client. At client's death
    // grantor-succession flips isGrantor:true→false; the projection layer
    // threads result.entities forward so subsequent years reclassify this
    // trust into the non-grantor trust-tax pass.
    const idgt: EntitySummary = {
      id: "idgt-1", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: true,
      grantor: "client",
    };
    const trustInput: DeathEventInput = {
      ...input,
      accounts: [],
      accountBalances: {},
      basisMap: {},
      entities: [idgt],
    };
    const result = applyFirstDeath(trustInput);
    expect(result.entities).toBeDefined();
    const post = result.entities.find((e) => e.id === "idgt-1");
    expect(post).toBeDefined();
    expect(post!.isGrantor).toBe(false);
    expect(post!.grantor).toBeUndefined();
    // Warning emitted for downstream observability.
    expect(result.warnings).toContain("idgt_grantor_flipped: idgt-1");
  });

  it("returns entities unchanged when no grantor-succession applies (skip case)", () => {
    // Spouse-grantor IDGT + client dies → no flip. Returned entities are
    // identity-equal-by-content to input (no spurious mutations).
    const spouseIdgt: EntitySummary = {
      id: "spouse-idgt", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: true,
      grantor: "spouse",
    };
    const trustInput: DeathEventInput = {
      ...input,
      accounts: [],
      accountBalances: {},
      basisMap: {},
      entities: [spouseIdgt],
    };
    const result = applyFirstDeath(trustInput);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].isGrantor).toBe(true);
    expect(result.entities[0].grantor).toBe("spouse");
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
    owners: [],
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
    const liabilities = [mkLiability({ owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }] })];
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

describe("distributeUnlinkedLiabilities — negative-share filter (4e)", () => {
  it("excludes recipients whose net ledger amount is ≤ 0 from proportional residual", () => {
    // Bequest-only recipient: appears in ledger only via a negative transfer.
    const bequestOnly: DeathTransfer = {
      year: 2050, deathOrder: 2, deceased: "client",
      sourceAccountId: null, sourceAccountName: null,
      sourceLiabilityId: "liab-original", sourceLiabilityName: "Visa",
      via: "will_liability_bequest",
      recipientKind: "family_member", recipientId: "fam-debt-only", recipientLabel: "Bob",
      amount: -5_000, basis: 0,
      resultingAccountId: null, resultingLiabilityId: "death-liab-bequest-1",
    };
    // Normal heir with positive asset inheritance.
    const normalHeir: DeathTransfer = {
      year: 2050, deathOrder: 2, deceased: "client",
      sourceAccountId: "acct-1", sourceAccountName: "Brokerage",
      sourceLiabilityId: null, sourceLiabilityName: null,
      via: "will",
      recipientKind: "family_member", recipientId: "fam-heir", recipientLabel: "Alice",
      amount: 100_000, basis: 50_000,
      resultingAccountId: "death-acct-1", resultingLiabilityId: null,
    };
    const residualUnlinkedDebt: Liability = {
      id: "liab-residual", name: "Student loan",
      balance: 20_000, interestRate: 0.05, monthlyPayment: 200,
      startYear: 2020, startMonth: 1, termMonths: 120, extraPayments: [], owners: [],
    };

    const result = distributeUnlinkedLiabilities(
      [residualUnlinkedDebt],
      [bequestOnly, normalHeir],
      2050,
      "client",
    );

    // Bob (net -5_000) should NOT receive a share of residual debt
    const bobShares = result.liabilityTransfers.filter(
      (t) => t.recipientId === "fam-debt-only",
    );
    expect(bobShares).toHaveLength(0);

    // Alice (net +100_000) should get the full residual debt
    const aliceShares = result.liabilityTransfers.filter(
      (t) => t.recipientId === "fam-heir",
    );
    expect(aliceShares).toHaveLength(1);
    expect(aliceShares[0].amount).toBe(-20_000);
  });
});

describe("applyFinalDeath orchestrator", () => {
  const mkAccount = (over: Partial<Account> = {}): Account => ({
    id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
    value: 100_000, basis: 60_000,
    growthRate: 0.05, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...over,
  });

  const mkInput = (over: Partial<DeathEventInput> = {}): DeathEventInput => {
    const accounts = over.accounts ?? [mkAccount()];
    const accountBalances: Record<string, number> = over.accountBalances ?? {};
    const basisMap: Record<string, number> = over.basisMap ?? {};
    // Default balance/basis maps mirror the account list.
    for (const a of accounts) {
      if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
      if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
    }
    // Always include the deceased principal FM so deceasedFmId resolves to LEGACY_FM_CLIENT.
    const callerFms = over.familyMembers ?? [];
    const deceasedPrincipalFm: FamilyMember = {
      id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
      firstName: "Client", lastName: "Test", dateOfBirth: "1970-01-01",
    };
    const principalFms = callerFms.some((f) => f.id === LEGACY_FM_CLIENT) ? [] : [deceasedPrincipalFm];
    const { familyMembers: _fm, ...rest } = over;
    return {
      year: 2050,
      deceased: "client",
      survivor: "spouse",  // note: 4c's applyFinalDeath treats this field loosely; orchestrator internally passes null to fallback
      will: null,
      accounts,
      accountBalances,
      basisMap,
      incomes: [],
      liabilities: [],
      familyMembers: [...principalFms, ...callerFms],
      externalBeneficiaries: [],
      entities: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0.025,
        planStartYear: 2026,
        planEndYear: 2080,
        estateAdminExpenses: 0,
        flatStateEstateRate: 0,
      },
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      ...rest,
    };
  };

  it("distributes an unwilled account to living children when no will exists (fallback tier 2)", () => {
    const children: FamilyMember[] = [
      { id: "c1", role: "child" as const, relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
      { id: "c2", role: "child" as const, relationship: "child", firstName: "B", lastName: null, dateOfBirth: null },
    ];
    const input = mkInput({ familyMembers: children });
    const result = applyFinalDeath(input);

    // 2 accounts (one per child), each $50k, both owned by child FM
    expect(result.accounts).toHaveLength(2);
    expect(controllingFamilyMember(result.accounts[0])).toBe("c1");
    expect(controllingFamilyMember(result.accounts[1])).toBe("c2");
    expect(result.accounts[0].value).toBeCloseTo(50_000, 2);
    expect(result.accounts[1].value).toBeCloseTo(50_000, 2);

    // 2 asset ledger entries, both via fallback_children with deathOrder=2
    const assetEntries = result.transfers.filter((t) => t.sourceAccountId != null);
    expect(assetEntries).toHaveLength(2);
    expect(assetEntries.every((t) => t.deathOrder === 2)).toBe(true);
    expect(assetEntries.every((t) => t.via === "fallback_children")).toBe(true);
  });

  it("falls back to tier 3 (Other Heirs sink) when no spouse + no children", () => {
    const input = mkInput();
    const result = applyFinalDeath(input);

    expect(result.accounts).toHaveLength(0);  // removed
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].via).toBe("fallback_other_heirs");
    expect(result.transfers[0].recipientKind).toBe("system_default");
    expect(result.transfers[0].deathOrder).toBe(2);
  });

  it("executes an always-condition will at 4c with deathOrder=2", () => {
    const children: FamilyMember[] = [
      { id: "c1", role: "child" as const, relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
    ];
    const will: Will = {
      id: "w1", grantor: "client", bequests: [
        {
          id: "b1", name: "Always bequest", kind: "asset" as const, assetMode: "all_assets" as const,
          accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 0,
          recipients: [{ recipientKind: "family_member" as const, recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const input = mkInput({ will, familyMembers: children });
    const result = applyFinalDeath(input);

    expect(result.accounts).toHaveLength(1);
    expect(controllingFamilyMember(result.accounts[0])).toBe("c1");
    const willEntry = result.transfers.find((t) => t.via === "will");
    expect(willEntry).toBeDefined();
    expect(willEntry!.deathOrder).toBe(2);
  });

  it("skips if_spouse_survives clauses and fires if_spouse_predeceased clauses at 4c", () => {
    const children: FamilyMember[] = [
      { id: "c1", role: "child" as const, relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
    ];
    const will: Will = {
      id: "w1", grantor: "client", bequests: [
        {
          id: "b1", name: "Spouse bequest", kind: "asset" as const, assetMode: "all_assets" as const,
          accountId: null, liabilityId: null,
          percentage: 100, condition: "if_spouse_survives" as const, sortOrder: 0,
          recipients: [{ recipientKind: "family_member" as const, recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
        {
          id: "b2", name: "No-spouse bequest", kind: "asset" as const, assetMode: "all_assets" as const,
          accountId: null, liabilityId: null,
          percentage: 100, condition: "if_spouse_predeceased" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member" as const, recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const input = mkInput({ will, familyMembers: children });
    const result = applyFinalDeath(input);

    // The if_spouse_predeceased bequest fires; the if_spouse_survives skips.
    // Account fully routed to c1 — no fallback warning.
    const willEntries = result.transfers.filter((t) => t.via === "will");
    expect(willEntries).toHaveLength(1);
    expect(willEntries[0].recipientId).toBe("c1");
    expect(result.warnings.filter((w) => w.startsWith("residual_fallback_fired"))).toHaveLength(0);
  });

  it("runs the unlinked-liability proportional distribution step (illiquid estate)", () => {
    // Illiquid estate: single real_estate account + $10k CC. After Task 10's
    // pipeline inversion, creditor-drain runs BEFORE the 4c chain — but
    // drainLiquidAssets only touches cash / taxable / life_insurance /
    // retirement, so a real_estate-only estate has no eligible accounts.
    // The full $10k falls through to the residual distribution helper.
    const children: FamilyMember[] = [
      { id: "c1", role: "child" as const, relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
    ];
    const home = mkAccount({
      id: "home", name: "Primary Home",
      category: "real_estate", subType: "primary_residence",
      value: 500_000, basis: 400_000, growthRate: 0.03,
    });
    const liabilities: Liability[] = [
      {
        id: "cc1", name: "Credit Card", balance: 10_000,
        interestRate: 0.18, monthlyPayment: 500,
        startYear: 2025, startMonth: 1, termMonths: 24, extraPayments: [], owners: [],
      },
    ];
    const input = mkInput({ accounts: [home], familyMembers: children, liabilities });
    const result = applyFinalDeath(input);

    // Creditor-drain produced no debits (no eligible liquid accounts) and
    // full $10k residual flowed through distributeUnlinkedLiabilities.
    expect(result.estateTax.creditorPayoffDebits).toHaveLength(0);
    expect(result.estateTax.creditorPayoffResidual).toBeCloseTo(10_000, 2);

    // Asset transfers: 1 ($500k home → c1). Liability transfers: 1 ($10k → c1).
    const liabEntries = result.transfers.filter((t) => t.via === "unlinked_liability_proportional");
    expect(liabEntries).toHaveLength(1);
    expect(liabEntries[0].recipientId).toBe("c1");
    expect(liabEntries[0].amount).toBeCloseTo(-10_000, 2);

    // Original CC removed, new family-member-owned CC added.
    expect(result.liabilities.some((l) => l.id === "cc1")).toBe(false);
    const newCC = result.liabilities.find((l) => l.ownerFamilyMemberId === "c1");
    expect(newCC).toBeDefined();
    expect(newCC!.balance).toBeCloseTo(10_000, 2);
  });

  it("clips deceased's personal incomes at final death year", () => {
    const incomes: Income[] = [
      { id: "sal1", type: "salary", name: "Salary", annualAmount: 100_000,
        startYear: 2030, endYear: 2070, growthRate: 0.03, owner: "client" },
      { id: "ent1", type: "trust", name: "Trust Income", annualAmount: 50_000,
        startYear: 2030, endYear: 2070, growthRate: 0.03, owner: "client", ownerEntityId: "e1" },
    ];
    const input = mkInput({ incomes });
    const result = applyFinalDeath(input);

    const salary = result.incomes.find((i) => i.id === "sal1");
    expect(salary!.endYear).toBe(2050);
    const trust = result.incomes.find((i) => i.id === "ent1");
    expect(trust!.endYear).toBe(2070);  // untouched (ownerEntityId)
  });

  it("passes entity-owned accounts through untouched", () => {
    const accounts = [
      mkAccount({ id: "a1", owners: [{ kind: "entity", entityId: "e1", percent: 1 }], value: 500_000, basis: 200_000 }),
      mkAccount({ id: "a2", value: 100_000, basis: 60_000 }),
    ];
    const entities: EntitySummary[] = [
      { id: "e1", includeInPortfolio: true, isGrantor: true },
    ];
    const input = mkInput({ accounts, entities });
    const result = applyFinalDeath(input);

    expect(result.accounts.find((a) => a.id === "a1")).toBeDefined();
    const a1 = result.accounts.find((a) => a.id === "a1")!;
    expect(controllingEntity(a1)).toBe("e1");
  });

  // Removed: "throws when a will clause routes 'spouse' as recipient at 4c".
  // Plan 4d-1 Task 10 replaced `assertFinalDeathInvariants` with a new set
  // focused on estate-tax integrity and entity grantor-succession
  // correctness; the spouse-at-4c guard was intentionally dropped. If this
  // guard comes back, it belongs at the will-validation layer (API
  // schema / form validation), not inside the 4c orchestrator.

  it("throws when any account remains with joint household ownership post-event (defensive)", () => {
    // This is impossible in production because 4b retitles joint accounts,
    // but the orchestrator should reject the data defensively.
    const accounts = [mkAccount({
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
    })];
    const input = mkInput({ accounts });
    expect(() => applyFinalDeath(input)).toThrow(/joint/i);
  });

  it("step-up: survivor's taxable brokerage passes to heir with full step-up", () => {
    const brok: Account = {
      id: "surv-brok", name: "Survivor Brokerage",
      category: "taxable", subType: "brokerage",
      value: 800_000, basis: 300_000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const alice: FamilyMember = {
      id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01",
    };
    const will: Will = {
      id: "w2", grantor: "client",
      bequests: [{
        id: "b1", name: "All to Alice",
        kind: "asset", assetMode: "all_assets",
        accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "child-a", percentage: 100, sortOrder: 0 }],
      }],
    };
    const input = mkInput({
      accounts: [brok],
      familyMembers: [alice],
      will,
    });
    const result = applyFinalDeath(input);
    const heirAccounts = result.accounts.filter((a) => controllingFamilyMember(a) === "child-a");
    expect(heirAccounts).toHaveLength(1);
    // Full step-up: basis = FMV = 800k
    expect(result.basisMap[heirAccounts[0].id]).toBeCloseTo(800_000, 2);
  });

  it("step-up: survivor's traditional IRA passes to heir with basis unchanged (IRD)", () => {
    const ira: Account = {
      id: "surv-ira", name: "Survivor IRA",
      category: "retirement", subType: "traditional_ira",
      value: 500_000, basis: 0,
      growthRate: 0.07, rmdEnabled: true,
      beneficiaries: [
        { id: "b-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const alice: FamilyMember = {
      id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01",
    };
    const input = mkInput({
      accounts: [ira],
      familyMembers: [alice],
    });
    const result = applyFinalDeath(input);
    const heirAccounts = result.accounts.filter((a) => controllingFamilyMember(a) === "child-a");
    expect(heirAccounts).toHaveLength(1);
    // No step-up for IRD: basis stays at 0
    expect(result.basisMap[heirAccounts[0].id]).toBeCloseTo(0, 2);
  });

  it("step-up: survivor's Roth IRA passes to heir with basis unchanged (still IRD category)", () => {
    const roth: Account = {
      id: "surv-roth", name: "Survivor Roth",
      category: "retirement", subType: "roth_ira",
      value: 400_000, basis: 150_000,
      growthRate: 0.07, rmdEnabled: false,
      beneficiaries: [
        { id: "b-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 },
      ],
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const alice: FamilyMember = {
      id: "child-a", role: "child" as const, relationship: "child", firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01",
    };
    const input = mkInput({
      accounts: [roth],
      familyMembers: [alice],
    });
    const result = applyFinalDeath(input);
    const heirAccounts = result.accounts.filter((a) => controllingFamilyMember(a) === "child-a");
    expect(heirAccounts).toHaveLength(1);
    // Category gate blocks step-up regardless of Roth vs traditional:
    expect(result.basisMap[heirAccounts[0].id]).toBeCloseTo(150_000, 2);
  });

  it("returns mutated entities reflecting grantor-flip when an IDGT's grantor dies at final death", () => {
    // Symmetric to the first-death case: a survivor-as-grantor IDGT must
    // also flip at final death so any post-loop reads (and the hypothetical-
    // estate-tax pipeline) see the correct classification.
    const idgt: EntitySummary = {
      id: "idgt-final", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: true,
      grantor: "client",
    };
    const input = mkInput({ entities: [idgt] });
    const result = applyFinalDeath(input);
    expect(result.entities).toBeDefined();
    const post = result.entities.find((e) => e.id === "idgt-final");
    expect(post).toBeDefined();
    expect(post!.isGrantor).toBe(false);
    expect(post!.grantor).toBeUndefined();
    expect(result.warnings).toContain("idgt_grantor_flipped: idgt-final");
  });
});
