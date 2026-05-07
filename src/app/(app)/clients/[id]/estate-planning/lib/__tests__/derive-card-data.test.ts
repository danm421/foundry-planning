import { describe, it, expect } from "vitest";
import {
  deriveClientCardData,
  deriveTrustCardData,
  deriveHeirCardData,
  deriveCharityCardData,
  taxTreatmentTag,
} from "../derive-card-data";
import type { ClientData, FamilyMember } from "@/engine/types";

const CLIENT_FM_ID = "fm-client-test";
const SPOUSE_FM_ID = "fm-spouse-test";

const clientFm: FamilyMember = {
  id: CLIENT_FM_ID, role: "client", relationship: "child",
  firstName: "Tom", lastName: "Smith", dateOfBirth: "1968-03-12",
};
const spouseFm: FamilyMember = {
  id: SPOUSE_FM_ID, role: "spouse", relationship: "child",
  firstName: "Linda", lastName: "Smith", dateOfBirth: "1970-05-20",
};

const baseClient = (overrides: Partial<ClientData["client"]> = {}): ClientData["client"] =>
  ({
    firstName: "Tom",
    lastName: "Smith",
    dateOfBirth: "1968-03-12",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "married_joint",
    ...overrides,
  } as ClientData["client"]);

const baseTree = (overrides: Partial<ClientData> = {}): ClientData =>
  ({
    accounts: [],
    entities: [],
    familyMembers: [clientFm, spouseFm],
    externalBeneficiaries: [],
    wills: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    transfers: [],
    gifts: [],
    withdrawalStrategy: [],
    planSettings: {} as ClientData["planSettings"],
    client: baseClient(),
    ...overrides,
  } as ClientData);

/** Build a minimal Account owned solely by the client FM. */
function clientAcct(id: string, name: string, category: ClientData["accounts"][0]["category"], value: number, extra: object = {}): ClientData["accounts"][0] {
  return {
    id, name, category, subType: "generic",
    value, basis: value, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
    ...extra,
  } as ClientData["accounts"][0];
}

/** Build a minimal Account owned solely by the spouse FM. */
function spouseAcct(id: string, name: string, category: ClientData["accounts"][0]["category"], value: number, extra: object = {}): ClientData["accounts"][0] {
  return {
    id, name, category, subType: "generic",
    value, basis: value, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 1 }],
    ...extra,
  } as ClientData["accounts"][0];
}

/** Build a fractional account owned 60% client, 40% spouse. */
function fractionalAcct(id: string, name: string, category: ClientData["accounts"][0]["category"], value: number, extra: object = {}): ClientData["accounts"][0] {
  return {
    id, name, category, subType: "generic",
    value, basis: value, growthRate: 0, rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.6 },
      { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.4 },
    ],
    ...extra,
  } as ClientData["accounts"][0];
}

/** Build an entity-owned Account. */
function entityAcct(id: string, name: string, category: ClientData["accounts"][0]["category"], value: number, entityId: string, extra: object = {}): ClientData["accounts"][0] {
  return {
    id, name, category, subType: "generic",
    value, basis: value, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "entity", entityId, percent: 1 }],
    ...extra,
  } as ClientData["accounts"][0];
}

describe("taxTreatmentTag", () => {
  it("maps traditional retirement → DEF", () => {
    expect(taxTreatmentTag({ category: "retirement" })).toBe("DEF");
  });
  it("maps taxable → TAX", () => {
    expect(taxTreatmentTag({ category: "taxable" })).toBe("TAX");
  });
  it("maps retirement + roth_ira subType → FREE", () => {
    expect(taxTreatmentTag({ category: "retirement", subType: "roth_ira" })).toBe("FREE");
  });
  it("maps retirement + 401k subType → DEF (mixed pre-tax/Roth)", () => {
    expect(taxTreatmentTag({ category: "retirement", subType: "401k" })).toBe("DEF");
  });
  it("maps cash → TAX (interest is taxable)", () => {
    expect(taxTreatmentTag({ category: "cash" })).toBe("TAX");
  });
  it("returns null for categories without a tag (real_estate, business)", () => {
    expect(taxTreatmentTag({ category: "real_estate" })).toBeNull();
    expect(taxTreatmentTag({ category: "business" })).toBeNull();
  });
});

describe("deriveClientCardData", () => {
  it("emits a single client card with rows for client's accounts", () => {
    const tree = baseTree({
      client: baseClient({ firstName: "Tom", lastName: "Smith" }),
      familyMembers: [clientFm], // no spouse FM
      accounts: [
        clientAcct("a1", "401k", "retirement", 500_000),
      ],
    });

    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    const tom = cards[0];
    expect(tom.ownerKey).toBe("client");
    expect(tom.name).toBe("Tom Smith");
    expect(tom.rows).toHaveLength(1);
    expect(tom.rows[0].accountName).toBe("401k");
    expect(tom.rows[0].taxTag).toBe("DEF");
    expect(tom.total).toBe(500_000);
  });

  it("emits both client and spouse cards when spouseName is set", () => {
    const tree = baseTree({
      client: baseClient({
        firstName: "Tom",
        lastName: "Smith",
        spouseName: "Linda Smith",
        spouseDob: "1970-05-20",
      }),
      familyMembers: [clientFm, spouseFm],
      accounts: [
        spouseAcct("a1", "Linda Roth IRA", "retirement", 200_000),
      ],
    });
    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(2);
    expect(cards[0].ownerKey).toBe("client");
    expect(cards[0].name).toBe("Tom Smith");
    expect(cards[1].ownerKey).toBe("spouse");
    expect(cards[1].name).toBe("Linda Smith");
    expect(cards[1].rows).toHaveLength(1);
    expect(cards[1].total).toBe(200_000);
  });

  it("excludes a grantor whose lifeExpectancy has elapsed (modeled-deceased view)", () => {
    const tree = baseTree({
      client: baseClient({ dateOfBirth: "1950-01-01", lifeExpectancy: 70 }),
    });
    expect(deriveClientCardData(tree, 2026)).toHaveLength(0);
  });

  it("tags a Roth IRA on the client card as FREE (not DEF)", () => {
    const tree = baseTree({
      accounts: [
        clientAcct("a1", "Tom Roth IRA", "retirement", 100_000, { subType: "roth_ira" }),
      ],
    });
    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].rows).toHaveLength(1);
    expect(cards[0].rows[0].taxTag).toBe("FREE");
  });

  it("ClientCardData rows include both solo and fractional accounts", () => {
    const tree = baseTree({
      accounts: [
        clientAcct("a1", "Solo", "retirement", 1_000_000),
        fractionalAcct("a2", "Joint", "taxable", 2_000_000),
      ],
    });
    const cards = deriveClientCardData(tree, 2026);
    const tom = cards.find((c) => c.ownerKey === "client")!;
    expect(tom.rows.map((r) => r.accountName)).toContain("Solo");
    expect(tom.rows.map((r) => r.accountName)).toContain("Joint");
    // total = 1_000_000 (solo 100%) + 1_200_000 (joint 60% of 2_000_000)
    expect(tom.total).toBe(2_200_000);
  });

  it("total reflects net worth: assets minus linked liability slices minus unlinked debt", () => {
    const tree = baseTree({
      accounts: [
        clientAcct("home", "Home", "real_estate" as ClientData["accounts"][0]["category"], 1_000_000),
      ],
      liabilities: [
        // linked mortgage
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
          owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
        },
        // unlinked credit card
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
          owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
        },
      ],
    });
    const cards = deriveClientCardData(tree, 2026);
    const tom = cards[0];
    // 1M home − 600K mortgage = 400K net asset; − 20K cc unlinked = 380K
    expect(tom.total).toBe(380_000);
    expect(tom.hasDebt).toBe(true);
    expect(tom.unlinkedLiabilities).toHaveLength(1);
    expect(tom.unlinkedLiabilities[0]).toMatchObject({ liabilityId: "cc", sliceValue: 20_000 });
  });

  it("hasDebt is false and unlinkedLiabilities is empty when no debt", () => {
    const tree = baseTree({
      accounts: [clientAcct("a1", "401k", "retirement", 500_000)],
    });
    const tom = deriveClientCardData(tree, 2026)[0];
    expect(tom.hasDebt).toBe(false);
    expect(tom.unlinkedLiabilities).toEqual([]);
  });
});

describe("deriveTrustCardData", () => {
  it("returns one card per trust entity, with rows and exemption usage", () => {
    const tree = baseTree({
      entities: [
        {
          id: "e1",
          name: "Tom's SLAT",
          entityType: "trust",
          trustSubType: "slat",
          isIrrevocable: true,
          exemptionConsumed: 2_400_000,
          grantor: "client",
          trustee: "Sarah",
          includeInPortfolio: false,
          isGrantor: false,
        },
      ] as unknown as ClientData["entities"],
      accounts: [
        entityAcct("a3", "SLAT Brokerage", "taxable", 2_400_000, "e1"),
      ],
      planSettings: { taxInflationRate: 0.03 } as ClientData["planSettings"],
    });
    const cards = deriveTrustCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Tom's SLAT");
    expect(cards[0].subType).toBe("slat");
    expect(cards[0].rows).toHaveLength(1);
    expect(cards[0].total).toBe(2_400_000);
    expect(cards[0].exemptionConsumed).toBe(2_400_000);
    expect(cards[0].exemptionAvailable).toBeGreaterThan(13_000_000);
  });

  it("excludes non-trust entities (businesses, foundations)", () => {
    const tree = baseTree({
      entities: [
        { id: "e2", name: "Acme Business", entityType: "llc", includeInPortfolio: false, isGrantor: false },
      ] as unknown as ClientData["entities"],
    });
    expect(deriveTrustCardData(tree, 2026)).toHaveLength(0);
  });
});

describe("deriveHeirCardData", () => {
  it("returns one row per (bequest × matching family-member recipient), carrying recipient percentage", () => {
    const childFm: FamilyMember = {
      id: "fm1", relationship: "child", role: "child",
      firstName: "Tom Jr", lastName: "S", dateOfBirth: "1995-01-01",
    };
    const tree = baseTree({
      familyMembers: [clientFm, spouseFm, childFm],
      accounts: [
        clientAcct("a1", "401k", "retirement", 500_000),
      ],
      wills: [
        {
          id: "w1",
          grantor: "client",
          bequests: [
            {
              id: "b1",
              name: "401k → kids",
              kind: "asset",
              assetMode: "specific",
              accountId: "a1",
              liabilityId: null,
              percentage: 100,
              condition: "always",
              sortOrder: 0,
              recipients: [
                { recipientKind: "family_member", recipientId: "fm1", percentage: 60, sortOrder: 0 },
                { recipientKind: "external_beneficiary", recipientId: "ex1", percentage: 40, sortOrder: 1 },
              ],
            },
          ],
        },
      ] as ClientData["wills"],
    });
    const cards = deriveHeirCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Tom Jr S");
    expect(cards[0].relationship).toBe("child");
    expect(cards[0].bequestsReceived).toHaveLength(1);
    expect(cards[0].bequestsReceived[0].assetName).toBe("401k");
    expect(cards[0].bequestsReceived[0].percentage).toBe(60);
    expect(cards[0].bequestsReceived[0].willGrantor).toBe("client");
    expect(cards[0].bequestsReceived[0].condition).toBe("always");
  });

  it("HeirCardData ownershipRows populated when heir directly owns an account", () => {
    const childFm: FamilyMember = {
      id: "fm-heir-1", relationship: "child", role: "child",
      firstName: "Jane", lastName: "Smith", dateOfBirth: "1998-06-15",
    };
    const tree = baseTree({
      familyMembers: [clientFm, spouseFm, childFm],
      accounts: [
        {
          id: "a-heir", name: "UTMA for Jane", category: "taxable", subType: "generic",
          value: 50_000, basis: 50_000, growthRate: 0, rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-heir-1", percent: 1 }],
        } as ClientData["accounts"][0],
      ],
    });
    const cards = deriveHeirCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].ownershipRows).toHaveLength(1);
    expect(cards[0].ownershipRows[0].accountName).toBe("UTMA for Jane");
    expect(cards[0].ownershipRows[0].sliceValue).toBe(50_000);
  });

  it("HeirCardData empty arrays when heir has neither bequests nor ownership", () => {
    const childFm: FamilyMember = {
      id: "fm-heir-2", relationship: "child", role: "child",
      firstName: "Bob", lastName: "Smith", dateOfBirth: "2000-01-01",
    };
    const tree = baseTree({
      familyMembers: [clientFm, spouseFm, childFm],
      accounts: [],
    });
    const cards = deriveHeirCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].bequestsReceived).toHaveLength(0);
    expect(cards[0].ownershipRows).toHaveLength(0);
  });
});

describe("deriveCharityCardData", () => {
  it("returns one card per external beneficiary with received bequests", () => {
    const tree = baseTree({
      externalBeneficiaries: [{ id: "ex1", name: "Stanford University", kind: "charity", charityType: "public" as const }],
      accounts: [
        clientAcct("a1", "DAF", "taxable", 1_000_000),
      ],
      wills: [
        {
          id: "w1",
          grantor: "client",
          bequests: [
            {
              id: "b1",
              name: "DAF → Stanford",
              kind: "asset",
              assetMode: "specific",
              accountId: "a1",
              liabilityId: null,
              percentage: 100,
              condition: "always",
              sortOrder: 0,
              recipients: [
                { recipientKind: "external_beneficiary", recipientId: "ex1", percentage: 100, sortOrder: 0 },
              ],
            },
          ],
        },
      ] as ClientData["wills"],
    });
    const cards = deriveCharityCardData(tree);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Stanford University");
    expect(cards[0].bequestsReceived).toHaveLength(1);
    expect(cards[0].bequestsReceived[0].percentage).toBe(100);
  });

  it("CharityCardData lifetimeGifts lists cash gifts in year order", () => {
    const tree = baseTree({
      externalBeneficiaries: [{ id: "ex1", name: "Red Cross", kind: "charity", charityType: "public" as const }],
      gifts: [
        {
          id: "g1", year: 2025, amount: 10_000, grantor: "client",
          recipientExternalBeneficiaryId: "ex1", useCrummeyPowers: false,
        },
        {
          id: "g2", year: 2023, amount: 5_000, grantor: "client",
          recipientExternalBeneficiaryId: "ex1", useCrummeyPowers: false,
        },
        // gift to a different charity — should not appear
        {
          id: "g3", year: 2024, amount: 2_000, grantor: "client",
          recipientExternalBeneficiaryId: "ex-other", useCrummeyPowers: false,
        },
      ] as ClientData["gifts"],
    });
    const cards = deriveCharityCardData(tree);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.lifetimeGifts).toHaveLength(2);
    // sorted by year ascending
    expect(card.lifetimeGifts[0].year).toBe(2023);
    expect(card.lifetimeGifts[0].amount).toBe(5_000);
    expect(card.lifetimeGifts[1].year).toBe(2025);
    expect(card.lifetimeGifts[1].amount).toBe(10_000);
    // Gift type has no accountId field — all gifts default to cash
    expect(card.lifetimeGifts[0].assetClass).toBe("cash");
    expect(card.lifetimeGifts[0].sourceLabel).toBe("Cash gift");
  });
});
