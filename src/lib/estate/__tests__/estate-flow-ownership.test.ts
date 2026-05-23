import { describe, it, expect } from "vitest";
import { buildOwnershipColumn } from "../estate-flow-ownership";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type { EstateFlowGift } from "../estate-flow-gifts";

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

  it("places a 100% entity-owned account in the entity's group", () => {
    // Post business-as-asset migration, entity groups in the ownership
    // column are uniformly tagged as "trust" — businesses live in
    // data.accounts and don't appear in data.entities. An entity owner that
    // doesn't resolve is treated as an orphan and emitted as "trust"
    // (data-quality fallback).
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

  it("does NOT flag an account as conflict when an all_assets bequest exists (no residuary, no beneficiaries)", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-allassets",
          name: "All Assets Covered",
          category: "taxable",
          subType: "brokerage",
          value: 60_000,
          basis: 50_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
      wills: [
        {
          id: "will-allassets",
          grantor: "client",
          bequests: [
            {
              id: "beq-all",
              name: "Everything",
              kind: "asset",
              assetMode: "all_assets",
              accountId: null,
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
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-allassets");
    expect(row?.hasConflict).toBe(false);
  });

  it("emits an entity's partial slice of a mixed account into the entity group", () => {
    // Post-migration: no business-self row is emitted (businesses live in
    // data.accounts). The entity group's subtotal is just the slice.
    const cd = data({
      entities: [
        {
          id: "ent-llc",
          name: "Test Bus",
          entityType: "llc",
          includeInPortfolio: false,
          isGrantor: false,
          owners: [{ familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      accounts: [
        {
          id: "acc-savings",
          name: "Savings Account",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.8 },
            { kind: "entity", entityId: "ent-llc", percent: 0.2 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);

    const client = out.groups.find((g) => g.kind === "client");
    expect(client!.assets.find((a) => a.accountId === "acc-savings")!.value).toBe(80_000);

    const llc = out.groups.find((g) => g.key === "entity:ent-llc");
    expect(llc).toBeDefined();
    const llcSavings = llc!.assets.find(
      (a) => a.accountId === "acc-savings" && a.rowKind === "account",
    );
    expect(llcSavings!.value).toBe(20_000);
    expect(llcSavings!.percent).toBe(0.2);
    expect(llcSavings!.isSplit).toBe(true);
    expect(llc!.subtotal).toBe(20_000);
  });

  it("values an entity's mixed-account slice at its locked EoY share in a projected year", () => {
    // Savings account split 80% client / 20% an LLC. By 2035 the household
    // drew the account down to a $70k balance, but the LLC's locked EoY
    // share is still $20k. The entity row must show the locked $20k (not the
    // naive $70k × 20% = $14k), and the client row absorbs the drawdown
    // ($70k − $20k = $50k, not $70k × 80% = $56k).
    const cd = data({
      entities: [
        {
          id: "ent-llc",
          name: "Test Bus",
          entityType: "llc",
          includeInPortfolio: false,
          isGrantor: false,
          value: 0,
          owners: [{ familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      accounts: [
        {
          id: "acc-savings",
          name: "Savings Account",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.8 },
            { kind: "entity", entityId: "ent-llc", percent: 0.2 },
          ],
        },
      ],
    } as unknown as Partial<ClientData>);

    const projection = {
      years: [
        {
          year: 2035,
          accountLedgers: { "acc-savings": { endingValue: 70_000 } },
          entityAccountSharesEoY: new Map([
            ["ent-llc", new Map([["acc-savings", 20_000]])],
          ]),
        },
      ],
    } as unknown as ProjectionResult;

    const out = buildOwnershipColumn(cd, { projection, asOfYear: 2035 });

    const llc = out.groups.find((g) => g.key === "entity:ent-llc")!;
    const llcSavings = llc.assets.find(
      (a) => a.accountId === "acc-savings" && a.rowKind === "account",
    )!;
    expect(llcSavings.value).toBeCloseTo(20_000, 2);

    const client = out.groups.find((g) => g.kind === "client")!;
    const clientSavings = client.assets.find((a) => a.accountId === "acc-savings")!;
    expect(clientSavings.value).toBeCloseTo(50_000, 2);
  });

  it("includes orphan-entity-owned account in a fallback group and grandTotal", () => {
    // After business-as-asset migration, an unresolved entity owner is
    // emitted as a "trust" group (data-quality fallback) so the value isn't
    // dropped from grandTotal.
    const cd = data({
      entities: [],
      accounts: [
        {
          id: "acc-orphan-entity",
          name: "Orphan Entity Account",
          category: "taxable",
          subType: "brokerage",
          value: 120_000,
          basis: 90_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "entity", entityId: "ent-missing", percent: 1 }],
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);

    const out = buildOwnershipColumn(cd);
    const orphanGroup = out.groups.find((g) => g.key === "entity:ent-missing");
    expect(orphanGroup).toBeDefined();
    expect(orphanGroup!.kind).toBe("trust");
    const row = orphanGroup!.assets.find((a) => a.accountId === "acc-orphan-entity");
    expect(row).toBeDefined();
    expect(row!.value).toBe(120_000);
    expect(out.grandTotal).toBe(120_000);
  });
});

function projectionWith(
  accountId: string,
  year: number,
  endingValue: number,
): ProjectionResult {
  return {
    years: [{ year, accountLedgers: { [accountId]: { endingValue } } }],
  } as unknown as ProjectionResult;
}

describe("buildOwnershipColumn — projected snapshot", () => {
  it("uses the projection's year-N ending value when asOfYear is given", () => {
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
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);
    const out = buildOwnershipColumn(cd, {
      projection: projectionWith("acc-1", 2035, 142_000),
      asOfYear: 2035,
    });
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-1");
    expect(row?.value).toBe(142_000);
  });

  it("uses base values (not the projection's year-0 ending value) at the today column", () => {
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
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);
    // The projection's first year (2026) already grew the account to 106k.
    // The "Today" column must still show the advisor-entered 100k.
    const out = buildOwnershipColumn(cd, {
      projection: projectionWith("acc-1", 2026, 106_000),
      asOfYear: 2026,
      todayYear: 2026,
    });
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-1");
    expect(row?.value).toBe(100_000);
  });

  it("drops an account whose projected value is ~0 at asOfYear", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-1",
          name: "Gifted away",
          category: "taxable",
          subType: "brokerage",
          value: 100_000,
          basis: 80_000,
          growthRate: 0.06,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);
    const out = buildOwnershipColumn(cd, {
      projection: projectionWith("acc-1", 2035, 0),
      asOfYear: 2035,
    });
    expect(out.groups.flatMap((g) => g.assets)).toHaveLength(0);
  });

  it("attaches a future-gift marker for an asset-once gift dated after asOfYear", () => {
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
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);
    const gifts: EstateFlowGift[] = [
      {
        kind: "asset-once",
        id: "g1",
        year: 2040,
        accountId: "acc-1",
        percent: 0.5,
        grantor: "client",
        recipient: { kind: "entity", id: "trust-1" },
      },
    ];
    const out = buildOwnershipColumn(cd, {
      projection: projectionWith("acc-1", 2035, 100_000),
      asOfYear: 2035,
      gifts,
    });
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-1");
    expect(row?.futureGifts).toEqual([{ giftId: "g1", year: 2040, percent: 0.5 }]);
  });

  it("omits a marker for a gift dated on or before asOfYear", () => {
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
          beneficiaries: [],
        },
      ],
    } as unknown as Partial<ClientData>);
    const gifts: EstateFlowGift[] = [
      {
        kind: "asset-once",
        id: "g1",
        year: 2030,
        accountId: "acc-1",
        percent: 0.5,
        grantor: "client",
        recipient: { kind: "entity", id: "trust-1" },
      },
    ];
    const out = buildOwnershipColumn(cd, {
      projection: projectionWith("acc-1", 2035, 100_000),
      asOfYear: 2035,
      gifts,
    });
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-1");
    expect(row?.futureGifts ?? []).toEqual([]);
  });
});

describe("buildOwnershipColumn — row kind & default cash", () => {
  it("flags a default-checking account row with isDefaultCash", () => {
    const cd = data({
      accounts: [
        {
          id: "acc-cash", name: "Household Checking", category: "cash",
          subType: "checking", value: 5_000, basis: 5_000, growthRate: 0,
          rmdEnabled: false, isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
    } as unknown as Partial<ClientData>);
    const out = buildOwnershipColumn(cd);
    const row = out.groups.flatMap((g) => g.assets).find((a) => a.accountId === "acc-cash");
    expect(row?.isDefaultCash).toBe(true);
    expect(row?.rowKind).toBe("account");
  });

  // The "business-self row" tests were removed: under the business-as-asset
  // model, businesses are top-level accounts in data.accounts, so they're
  // rendered as ordinary account rows (rowKind: "account") through the
  // per-account loop — no synthetic business-self entity row exists.

  it("does not emit a business-self row for a trust entity", () => {
    const cd = data({
      entities: [
        {
          id: "ent-trust", name: "Family Trust", entityType: "trust",
          includeInPortfolio: false, isGrantor: true,
        },
      ],
    } as unknown as Partial<ClientData>);
    const out = buildOwnershipColumn(cd);
    expect(out.groups.find((g) => g.key === "entity:ent-trust")).toBeUndefined();
  });

  it("does not emit a business-self row for a foundation entity", () => {
    const cd = data({
      entities: [
        {
          id: "ent-foundation", name: "Smith Family Foundation", entityType: "foundation",
          includeInPortfolio: false, isGrantor: false,
        },
      ],
    } as unknown as Partial<ClientData>);
    const out = buildOwnershipColumn(cd);
    // Foundation groups are only emitted if they have account children;
    // with no accounts, the group is dropped entirely.
    const foundationGroup = out.groups.find((g) => g.key === "entity:ent-foundation");
    expect(foundationGroup).toBeUndefined();
  });
});
