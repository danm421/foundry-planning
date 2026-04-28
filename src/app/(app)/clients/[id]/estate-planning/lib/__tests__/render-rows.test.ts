import { describe, it, expect } from "vitest";
import { rowsForFamilyMember, rowsForEntity } from "../render-rows";
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
});
