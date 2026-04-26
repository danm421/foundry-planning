import { describe, it, expect } from "vitest";
import {
  deriveClientCardData,
  deriveTrustCardData,
  deriveHeirCardData,
  deriveCharityCardData,
  taxTreatmentTag,
} from "../derive-card-data";
import type { ClientData } from "@/engine/types";

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
    familyMembers: [],
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
  it("maps retirement + roth_401k subType → FREE", () => {
    expect(taxTreatmentTag({ category: "retirement", subType: "roth_401k" })).toBe("FREE");
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
  it("emits a single client card when no spouse is set, and groups outright vs joint accounts", () => {
    const tree = baseTree({
      client: baseClient({ firstName: "Tom", lastName: "Smith" }),
      accounts: [
        { id: "a1", name: "401k", category: "retirement", value: 500_000, owner: "client" },
        { id: "a2", name: "Joint Brokerage", category: "taxable", value: 1_000_000, owner: "joint" },
      ] as ClientData["accounts"],
    });

    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    const tom = cards[0];
    expect(tom.ownerKey).toBe("client");
    expect(tom.name).toBe("Tom Smith");
    expect(tom.outrightAssets).toHaveLength(1);
    expect(tom.outrightAssets[0].name).toBe("401k");
    expect(tom.outrightAssets[0].tag).toBe("DEF");
    expect(tom.jointAssets).toHaveLength(1);
    expect(tom.outrightTotal).toBe(500_000);
    expect(tom.jointHalfTotal).toBe(500_000);
  });

  it("emits both client and spouse cards when spouseName is set", () => {
    const tree = baseTree({
      client: baseClient({
        firstName: "Tom",
        lastName: "Smith",
        spouseName: "Linda Smith",
        spouseDob: "1970-05-20",
      }),
      accounts: [
        { id: "a1", name: "Linda Roth IRA", category: "retirement", value: 200_000, owner: "spouse" },
      ] as ClientData["accounts"],
    });
    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(2);
    expect(cards[0].ownerKey).toBe("client");
    expect(cards[0].name).toBe("Tom Smith");
    expect(cards[1].ownerKey).toBe("spouse");
    expect(cards[1].name).toBe("Linda Smith");
    expect(cards[1].outrightAssets).toHaveLength(1);
    expect(cards[1].outrightTotal).toBe(200_000);
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
        {
          id: "a1",
          name: "Tom Roth IRA",
          category: "retirement",
          subType: "roth_ira",
          value: 100_000,
          owner: "client",
        },
      ] as ClientData["accounts"],
    });
    const cards = deriveClientCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].outrightAssets).toHaveLength(1);
    expect(cards[0].outrightAssets[0].tag).toBe("FREE");
  });
});

describe("deriveTrustCardData", () => {
  it("returns one card per trust entity, with held assets and exemption usage", () => {
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
        { id: "a3", name: "SLAT Brokerage", category: "taxable", value: 2_400_000, owner: "client", ownerEntityId: "e1" },
      ] as ClientData["accounts"],
      planSettings: { taxInflationRate: 0.03 } as ClientData["planSettings"],
    });
    const cards = deriveTrustCardData(tree, 2026);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Tom's SLAT");
    expect(cards[0].subType).toBe("slat");
    expect(cards[0].heldAssets).toHaveLength(1);
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
    const tree = baseTree({
      familyMembers: [
        { id: "fm1", relationship: "child", firstName: "Tom Jr", lastName: "S", dateOfBirth: "1995-01-01" },
      ] as ClientData["familyMembers"],
      accounts: [
        { id: "a1", name: "401k", category: "retirement", value: 500_000, owner: "client" },
      ] as ClientData["accounts"],
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
});

describe("deriveCharityCardData", () => {
  it("returns one card per external beneficiary with received bequests", () => {
    const tree = baseTree({
      externalBeneficiaries: [{ id: "ex1", name: "Stanford University", kind: "charity" }],
      accounts: [
        { id: "a1", name: "DAF", category: "taxable", value: 1_000_000, owner: "client" },
      ] as ClientData["accounts"],
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
});
