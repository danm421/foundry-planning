import { describe, it, expect } from "vitest";
import { rowsForFamilyMember, rowsForEntity, unlinkedLiabilitiesForFamilyMember } from "../render-rows";
import type { ClientData } from "@/engine/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseTree = (overrides: Partial<ClientData> = {}): ClientData =>
  ({
    client: {
      firstName: "Tom",
      lastName: "Cooper",
      dateOfBirth: "1968-03-12",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
    } as ClientData["client"],
    accounts: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    withdrawalStrategy: [],
    planSettings: {} as ClientData["planSettings"],
    giftEvents: [],
    entities: [],
    familyMembers: [
      {
        id: "fm-tom",
        role: "client",
        relationship: "other",
        firstName: "Tom",
        lastName: "Cooper",
        dateOfBirth: "1968-03-12",
      },
      {
        id: "fm-linda",
        role: "spouse",
        relationship: "other",
        firstName: "Linda",
        lastName: "Cooper",
        dateOfBirth: "1970-05-20",
      },
    ],
    ...overrides,
  } as ClientData);

/** Minimal account shape: sole FM owner. */
function mkAcct(
  id: string,
  name: string,
  category: ClientData["accounts"][0]["category"],
  value: number,
  owners: ClientData["accounts"][0]["owners"],
): ClientData["accounts"][0] {
  return {
    id,
    name,
    category,
    subType: "generic",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners,
  } as ClientData["accounts"][0];
}

// ── Two-account fixture: solo + mixed ownership ───────────────────────────────
//   a1: "Solo" — $1M, 100% Tom
//   a2: "Joint" — $2M, 60% Tom / 30% Linda / 10% SLAT

const tree = baseTree({
  entities: [
    { id: "ent-slat", entityType: "trust", isIrrevocable: true, name: "SLAT", includeInPortfolio: false, isGrantor: true },
  ],
  accounts: [
    mkAcct("a1", "Solo", "taxable", 1_000_000, [
      { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
    ]),
    mkAcct("a2", "Joint", "taxable", 2_000_000, [
      { kind: "family_member", familyMemberId: "fm-tom", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-linda", percent: 0.3 },
      { kind: "entity", entityId: "ent-slat", percent: 0.1 },
    ]),
  ],
});

// ── Core tests ────────────────────────────────────────────────────────────────

describe("render-rows", () => {
  it("rowsForFamilyMember returns one row per slice the FM owns", () => {
    const rows = rowsForFamilyMember(tree, "fm-tom");
    expect(rows).toHaveLength(2);
    // Both accounts are category="taxable" so sort is by sliceValue descending:
    //   a2 Joint slice = $1.2M (60% of $2M) > a1 Solo slice = $1M
    expect(rows[0]).toMatchObject({
      accountId: "a2",
      accountName: "Joint",
      ownerPercent: 0.6,
      sliceValue: 1_200_000,
      hasMultipleOwners: true,
      coOwners: [
        { label: "Linda", percent: 0.3 },
        { label: "SLAT", percent: 0.1 },
      ],
    });
    expect(rows[1]).toMatchObject({
      accountId: "a1",
      accountName: "Solo",
      ownerPercent: 1,
      sliceValue: 1_000_000,
      hasMultipleOwners: false,
      coOwners: [],
    });
  });

  it("rowsForEntity returns one row per slice the entity owns", () => {
    const rows = rowsForEntity(tree, "ent-slat");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownerPercent: 0.1, sliceValue: 200_000 });
  });

  it("rowsForFamilyMember returns [] when FM owns nothing", () => {
    const rows = rowsForFamilyMember(tree, "fm-nobody");
    expect(rows).toEqual([]);
  });

  it("rowsForEntity returns [] when entity owns nothing", () => {
    const rows = rowsForEntity(tree, "ent-nobody");
    expect(rows).toEqual([]);
  });

  it("coOwners excludes self (entity call returns co-owners without the entity)", () => {
    const rows = rowsForEntity(tree, "ent-slat");
    const coOwners = rows[0].coOwners;
    expect(coOwners.every((c) => c.label !== "SLAT")).toBe(true);
    expect(coOwners).toHaveLength(2); // Tom + Linda
  });

  it("accounts with empty owners array produce no rows", () => {
    const emptyOwners = baseTree({
      accounts: [
        {
          ...mkAcct("a3", "Empty", "taxable", 500_000, []),
          owners: [],
        },
      ],
    });
    expect(rowsForFamilyMember(emptyOwners, "fm-tom")).toHaveLength(0);
    expect(rowsForEntity(emptyOwners, "ent-slat")).toHaveLength(0);
  });

  it("multi-entity ownership: each entity sees only its own slice", () => {
    const multiEntityTree = baseTree({
      entities: [
        { id: "ent-slat", entityType: "trust", isIrrevocable: true, name: "SLAT", includeInPortfolio: false, isGrantor: true },
        { id: "ent-idgt", entityType: "trust", isIrrevocable: true, name: "IDGT", includeInPortfolio: false, isGrantor: true },
      ],
      accounts: [
        mkAcct("a4", "Split Trust Acct", "taxable", 1_000_000, [
          { kind: "entity", entityId: "ent-slat", percent: 0.5 },
          { kind: "entity", entityId: "ent-idgt", percent: 0.5 },
        ]),
      ],
    });
    const slatRows = rowsForEntity(multiEntityTree, "ent-slat");
    expect(slatRows).toHaveLength(1);
    expect(slatRows[0]).toMatchObject({ ownerPercent: 0.5, sliceValue: 500_000 });
    // co-owner should be IDGT
    expect(slatRows[0].coOwners).toHaveLength(1);
    expect(slatRows[0].coOwners[0].label).toBe("IDGT");

    const idgtRows = rowsForEntity(multiEntityTree, "ent-idgt");
    expect(idgtRows).toHaveLength(1);
    expect(idgtRows[0]).toMatchObject({ ownerPercent: 0.5, sliceValue: 500_000 });
    expect(idgtRows[0].coOwners[0].label).toBe("SLAT");
  });

  it("taxTag is TAX for category=taxable accounts", () => {
    const rows = rowsForFamilyMember(tree, "fm-tom");
    expect(rows[0].taxTag).toBe("TAX");
  });

  it("taxTag is DEF for retirement accounts (no subType)", () => {
    const retTree = baseTree({
      accounts: [
        mkAcct("ret1", "401k", "retirement", 300_000, [
          { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
        ]),
      ],
    });
    const rows = rowsForFamilyMember(retTree, "fm-tom");
    expect(rows[0].taxTag).toBe("DEF");
  });

  it("taxTag is FREE for roth accounts", () => {
    const rothTree = baseTree({
      accounts: [
        {
          ...mkAcct("roth1", "Roth IRA", "retirement", 100_000, [
            { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
          ]),
          subType: "roth_ira",
        },
      ],
    });
    const rows = rowsForFamilyMember(rothTree, "fm-tom");
    expect(rows[0].taxTag).toBe("FREE");
  });

  it("sort: same category rows sorted by sliceValue descending", () => {
    const sortTree = baseTree({
      accounts: [
        mkAcct("s1", "Small", "taxable", 100_000, [
          { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
        ]),
        mkAcct("s2", "Large", "taxable", 900_000, [
          { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
        ]),
      ],
    });
    const rows = rowsForFamilyMember(sortTree, "fm-tom");
    expect(rows[0].accountName).toBe("Large");
    expect(rows[1].accountName).toBe("Small");
  });

  // ── linked-liability handling ──────────────────────────────────────────────

  it("linked liability: subtracts owner's debt slice from sliceValue → netSliceValue", () => {
    const homeTree = baseTree({
      accounts: [
        mkAcct("home", "Home", "real_estate" as ClientData["accounts"][0]["category"], 1_000_000, [
          { kind: "family_member", familyMemberId: "fm-tom", percent: 1 },
        ]),
      ],
      liabilities: [
        {
          id: "mtg",
          name: "Mortgage",
          balance: 600_000,
          interestRate: 0.05,
          monthlyPayment: 3000,
          startYear: 2020,
          startMonth: 1,
          termMonths: 360,
          linkedPropertyId: "home",
          extraPayments: [],
          owners: [{ kind: "family_member", familyMemberId: "fm-tom", percent: 1 }],
        },
      ],
    });
    const rows = rowsForFamilyMember(homeTree, "fm-tom");
    expect(rows).toHaveLength(1);
    expect(rows[0].sliceValue).toBe(1_000_000);
    expect(rows[0].linkedLiabilityBalance).toBe(600_000);
    expect(rows[0].netSliceValue).toBe(400_000);
  });

  it("linked liability: multi-owner liability is sliced by owner.percent", () => {
    // Joint home, joint mortgage — each spouse sees 50% of debt.
    const jointHomeTree = baseTree({
      accounts: [
        mkAcct("home", "Home", "real_estate" as ClientData["accounts"][0]["category"], 1_000_000, [
          { kind: "family_member", familyMemberId: "fm-tom", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-linda", percent: 0.5 },
        ]),
      ],
      liabilities: [
        {
          id: "mtg",
          name: "Mortgage",
          balance: 400_000,
          interestRate: 0.05,
          monthlyPayment: 2000,
          startYear: 2020,
          startMonth: 1,
          termMonths: 360,
          linkedPropertyId: "home",
          extraPayments: [],
          owners: [
            { kind: "family_member", familyMemberId: "fm-tom", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-linda", percent: 0.5 },
          ],
        },
      ],
    });
    const tomRows = rowsForFamilyMember(jointHomeTree, "fm-tom");
    expect(tomRows[0].sliceValue).toBe(500_000);          // 1M × 0.5
    expect(tomRows[0].linkedLiabilityBalance).toBe(200_000); // 400K × 0.5
    expect(tomRows[0].netSliceValue).toBe(300_000);

    const lindaRows = rowsForFamilyMember(jointHomeTree, "fm-linda");
    expect(lindaRows[0].linkedLiabilityBalance).toBe(200_000);
    expect(lindaRows[0].netSliceValue).toBe(300_000);
  });

  it("linked liability: zero linkedLiabilityBalance when none attached → netSliceValue equals sliceValue", () => {
    const rows = rowsForFamilyMember(tree, "fm-tom");
    expect(rows.every((r) => r.linkedLiabilityBalance === 0)).toBe(true);
    expect(rows.every((r) => r.netSliceValue === r.sliceValue)).toBe(true);
  });

  // ── unlinked-liability enumeration ─────────────────────────────────────────

  it("unlinkedLiabilitiesForFamilyMember: returns liabilities with no linkedPropertyId, sliced by owner.percent", () => {
    const ccTree = baseTree({
      liabilities: [
        // unlinked, joint
        {
          id: "cc",
          name: "Credit Card",
          balance: 20_000,
          interestRate: 0.18,
          monthlyPayment: 500,
          startYear: 2024,
          startMonth: 1,
          termMonths: 60,
          extraPayments: [],
          owners: [
            { kind: "family_member", familyMemberId: "fm-tom", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-linda", percent: 0.5 },
          ],
        },
        // unlinked, solo Tom
        {
          id: "loan",
          name: "Personal Loan",
          balance: 30_000,
          interestRate: 0.07,
          monthlyPayment: 600,
          startYear: 2025,
          startMonth: 1,
          termMonths: 60,
          extraPayments: [],
          owners: [{ kind: "family_member", familyMemberId: "fm-tom", percent: 1 }],
        },
        // linked — should NOT appear
        {
          id: "mtg",
          name: "Mortgage",
          balance: 500_000,
          interestRate: 0.05,
          monthlyPayment: 2500,
          startYear: 2020,
          startMonth: 1,
          termMonths: 360,
          linkedPropertyId: "some-home",
          extraPayments: [],
          owners: [{ kind: "family_member", familyMemberId: "fm-tom", percent: 1 }],
        },
      ],
    });
    const tomDebt = unlinkedLiabilitiesForFamilyMember(ccTree, "fm-tom");
    expect(tomDebt).toHaveLength(2);
    // Sorted descending by sliceValue
    expect(tomDebt[0]).toMatchObject({ liabilityId: "loan", sliceValue: 30_000, ownerPercent: 1 });
    expect(tomDebt[1]).toMatchObject({ liabilityId: "cc", sliceValue: 10_000, ownerPercent: 0.5 });
    // Mortgage excluded
    expect(tomDebt.find((d) => d.liabilityId === "mtg")).toBeUndefined();

    const lindaDebt = unlinkedLiabilitiesForFamilyMember(ccTree, "fm-linda");
    expect(lindaDebt).toHaveLength(1);
    expect(lindaDebt[0]).toMatchObject({ liabilityId: "cc", sliceValue: 10_000 });
  });

  it("unlinkedLiabilitiesForFamilyMember: empty when no liabilities", () => {
    expect(unlinkedLiabilitiesForFamilyMember(tree, "fm-tom")).toEqual([]);
  });
});
