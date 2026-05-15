import { describe, it, expect } from "vitest";
import { buildOwnershipColumn } from "../estate-flow-ownership";
import type { ClientData } from "@/engine/types";

/** Minimal ClientData stub — real fields used by the builder, everything else cast away. */
function data(overrides: Partial<ClientData>): ClientData {
  return {
    client: {
      firstName: "Pat",
      lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: "married_joint",
    },
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat", lastName: "Smith", dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: "Smith", dateOfBirth: "1972-06-15" },
    ],
    accounts: [],
    entities: [],
    liabilities: [],
    wills: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.25,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2055,
    },
    giftEvents: [],
    ...overrides,
  } as unknown as ClientData;
}

describe("buildOwnershipColumn", () => {
  it("groups a solely-client-owned account under Client", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-1",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 80_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [
            { id: "b1", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const client = out.groups.find((g) => g.kind === "client");
    expect(client).toBeDefined();
    expect(client!.assets.map((a) => a.accountId)).toContain("acc-1");
    expect(client!.subtotal).toBe(100_000);
  });

  it("splits a 60/40 account into Client and Spouse groups at fractional value", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-2",
          name: "Joint-ish",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 80_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.4 },
          ],
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const client = out.groups.find((g) => g.kind === "client");
    const spouse = out.groups.find((g) => g.kind === "spouse");

    expect(client).toBeDefined();
    expect(spouse).toBeDefined();

    const clientRow = client!.assets.find((a) => a.accountId === "acc-2");
    const spouseRow = spouse!.assets.find((a) => a.accountId === "acc-2");

    expect(clientRow?.value).toBeCloseTo(60_000);
    expect(spouseRow?.value).toBeCloseTo(40_000);
    expect(clientRow?.isSplit).toBe(true);
    expect(spouseRow?.isSplit).toBe(true);
    expect(clientRow?.percent).toBeCloseTo(0.6);
    expect(spouseRow?.percent).toBeCloseTo(0.4);
  });

  it("places a 100% trust-owned account in that trust's group", () => {
    const cd = data({
      entities: [
        {
          id: "ent-trust-1",
          name: "Smith Family Trust",
          entityType: "trust",
          isIrrevocable: false,
          includeInPortfolio: false,
          isGrantor: true,
        },
      ],
      accounts: [
        {
          id: "acc-3",
          name: "Trust Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 200_000,
          basis: 150_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "entity", entityId: "ent-trust-1", percent: 1 }],
          beneficiaries: [
            { id: "b2", tier: "primary", percentage: 100, householdRole: "client", sortOrder: 0 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const trustGroup = out.groups.find((g) => g.key === "entity:ent-trust-1");
    expect(trustGroup).toBeDefined();
    expect(trustGroup!.kind).toBe("trust");
    expect(trustGroup!.label).toBe("Smith Family Trust");
    expect(trustGroup!.assets.map((a) => a.accountId)).toContain("acc-3");
    expect(trustGroup!.subtotal).toBe(200_000);
  });

  it("places a 100% LLC-owned account in a business group", () => {
    const cd = data({
      entities: [
        {
          id: "ent-llc-1",
          name: "Smith Holdings LLC",
          entityType: "llc",
          includeInPortfolio: false,
          isGrantor: false,
        },
      ],
      accounts: [
        {
          id: "acc-4",
          name: "LLC Investment",
          category: "taxable",
          subType: "brokerage",
          value: 500_000,
          basis: 400_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "entity", entityId: "ent-llc-1", percent: 1 }],
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const bizGroup = out.groups.find((g) => g.key === "entity:ent-llc-1");
    expect(bizGroup).toBeDefined();
    expect(bizGroup!.kind).toBe("business");
    expect(bizGroup!.label).toBe("Smith Holdings LLC");
    expect(bizGroup!.assets.map((a) => a.accountId)).toContain("acc-4");
  });

  it("nets a linked liability against the asset's group subtotal", () => {
    const cd = data({
      accounts: [
        {
          id: "home-1",
          name: "Primary Home",
          category: "real_estate",
          subType: "primary_home",
          value: 800_000,
          basis: 300_000,
          growthRate: 0.03,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [
            { id: "b3", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
          ],
        },
      ],
      liabilities: [
        {
          id: "mort-1",
          name: "Mortgage",
          balance: 300_000,
          interestRate: 0.065,
          monthlyPayment: 2_000,
          startYear: 2020,
          startMonth: 1,
          termMonths: 360,
          extraPayments: [],
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          linkedPropertyId: "home-1",
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const client = out.groups.find((g) => g.kind === "client");
    expect(client).toBeDefined();

    const homeRow = client!.assets.find((a) => a.accountId === "home-1");
    expect(homeRow).toBeDefined();
    expect(homeRow!.linkedLiabilities).toHaveLength(1);
    expect(homeRow!.linkedLiabilities[0].liabilityId).toBe("mort-1");
    expect(homeRow!.linkedLiabilities[0].balance).toBe(300_000);
    expect(homeRow!.netValue).toBe(500_000); // 800k − 300k
    expect(client!.subtotal).toBe(500_000);
  });

  it("nets linked liability at fractional owner slice for split ownership", () => {
    const cd = data({
      accounts: [
        {
          id: "home-2",
          name: "Vacation Home",
          category: "real_estate",
          subType: "vacation_home",
          value: 400_000,
          basis: 200_000,
          growthRate: 0.03,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
          beneficiaries: [],
        },
      ],
      liabilities: [
        {
          id: "mort-2",
          name: "Vacation Mortgage",
          balance: 100_000,
          interestRate: 0.07,
          monthlyPayment: 1_000,
          startYear: 2022,
          startMonth: 6,
          termMonths: 240,
          extraPayments: [],
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
          linkedPropertyId: "home-2",
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const client = out.groups.find((g) => g.kind === "client");
    const spouse = out.groups.find((g) => g.kind === "spouse");

    const clientRow = client!.assets.find((a) => a.accountId === "home-2");
    const spouseRow = spouse!.assets.find((a) => a.accountId === "home-2");

    // Client owns 50% of 400k = 200k; 50% of 100k mortgage = 50k → net 150k
    expect(clientRow!.value).toBeCloseTo(200_000);
    expect(clientRow!.linkedLiabilities[0].balance).toBeCloseTo(50_000);
    expect(clientRow!.netValue).toBeCloseTo(150_000);
    // Same for spouse
    expect(spouseRow!.netValue).toBeCloseTo(150_000);
  });

  it("flags an account with no beneficiary and no will provision as a conflict", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-orphan",
          name: "Orphan",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
      wills: [],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-orphan");
    expect(row?.hasConflict).toBe(true);
  });

  it("does NOT flag an account as conflict when it has beneficiaries", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-ok",
          name: "With Bene",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [
            { id: "b4", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
          ],
        },
      ],
      wills: [],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-ok");
    expect(row?.hasConflict).toBe(false);
  });

  it("does NOT flag an account as conflict when a specific will bequest names it", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-willed",
          name: "In Will",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
      wills: [
        {
          id: "will-1",
          grantor: "client",
          bequests: [
            {
              id: "beq-1",
              name: "My Brokerage",
              kind: "asset",
              assetMode: "specific",
              accountId: "acc-willed",
              liabilityId: null,
              percentage: 100,
              condition: "always",
              sortOrder: 0,
              recipients: [{ recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 }],
            },
          ],
          residuaryRecipients: [],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-willed");
    expect(row?.hasConflict).toBe(false);
  });

  it("does NOT flag an account as conflict when a residuary clause exists in the owner's will", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-residuary",
          name: "Residuary",
          category: "taxable",
          subType: "brokerage",
          value: 75_000,
          basis: 60_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
      wills: [
        {
          id: "will-1",
          grantor: "client",
          bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-residuary");
    expect(row?.hasConflict).toBe(false);
  });

  it("grandTotal sums all group subtotals", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-c",
          name: "Client Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 80_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [{ id: "b5", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 }],
        },
        {
          id: "acc-s",
          name: "Spouse IRA",
          category: "retirement",
          subType: "ira",
          value: 200_000,
          basis: 0,
          growthRate: 0.07,
          rmdEnabled: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
          beneficiaries: [{ id: "b6", tier: "primary", percentage: 100, householdRole: "client", sortOrder: 0 }],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    expect(out.grandTotal).toBe(300_000);
  });

  it("drops empty groups", () => {
    const cd = data({
      entities: [
        {
          id: "ent-empty",
          name: "Empty Trust",
          entityType: "trust",
          includeInPortfolio: false,
          isGrantor: true,
        },
      ],
      accounts: [
        {
          id: "acc-c2",
          name: "Client Only",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [{ id: "b7", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 }],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    // The empty trust entity should not appear in groups
    const emptyTrust = out.groups.find((g) => g.key === "entity:ent-empty");
    expect(emptyTrust).toBeUndefined();
    // Spouse group should also not appear (no spouse accounts)
    const spouseGroup = out.groups.find((g) => g.kind === "spouse");
    expect(spouseGroup).toBeUndefined();
    // Only client group should appear
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].kind).toBe("client");
  });

  it("hasBeneficiaries is true when account has beneficiaries", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-bene",
          name: "With Bene",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [
            { id: "b8", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-bene");
    expect(row?.hasBeneficiaries).toBe(true);
  });

  it("hasBeneficiaries is false when account has no beneficiaries", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-nobene",
          name: "No Bene",
          category: "taxable",
          subType: "brokerage",
          value: 50_000,
          basis: 40_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-nobene");
    expect(row?.hasBeneficiaries).toBe(false);
  });
});
