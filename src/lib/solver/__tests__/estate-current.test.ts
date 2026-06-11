import { describe, it, expect } from "vitest";
import type { Account, ClientData, EntitySummary, Gift } from "@/engine/types";
import {
  currentRevocableTrusts,
  currentTrustEntities,
  currentCharities,
  summarizeCurrentGift,
} from "../estate-current";

const acct = (over: Partial<Account>): Account =>
  ({
    id: "a", name: "Acct", category: "taxable", subType: "brokerage",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "individual", owners: [],
    ...over,
  } as unknown as Account);

describe("currentRevocableTrusts", () => {
  it("groups tagged accounts by trust name and ignores untagged", () => {
    const trusts = currentRevocableTrusts([
      acct({ id: "1", name: "Brokerage", revocableTrustName: "Smith RLT" }),
      acct({ id: "2", name: "Cash", revocableTrustName: "Smith RLT" }),
      acct({ id: "3", name: "401k", revocableTrustName: undefined }),
    ]);
    expect(trusts).toEqual([{ name: "Smith RLT", accountNames: ["Brokerage", "Cash"] }]);
  });

  it("returns [] when nothing is tagged", () => {
    expect(currentRevocableTrusts([acct({ revocableTrustName: undefined })])).toEqual([]);
  });
});

describe("currentTrustEntities", () => {
  it("keeps trust entities and drops business entities", () => {
    const entities = [
      { id: "t", name: "ILIT", entityType: "trust", trustSubType: "ilit" },
      { id: "b", name: "Family LLC", entityType: "llc" },
    ] as unknown as EntitySummary[];
    expect(currentTrustEntities(entities).map((e) => e.id)).toEqual(["t"]);
  });

  it("treats a trustSubType-only entity as a trust", () => {
    const entities = [{ id: "x", trustSubType: "crt" }] as unknown as EntitySummary[];
    expect(currentTrustEntities(entities).map((e) => e.id)).toEqual(["x"]);
  });
});

describe("currentCharities", () => {
  it("keeps charity beneficiaries only", () => {
    const list = currentCharities([
      { id: "c", name: "Red Cross", kind: "charity", charityType: "public" },
      { id: "i", name: "Cousin", kind: "individual", charityType: "public" },
    ]);
    expect(list).toEqual([{ id: "c", name: "Red Cross", charityType: "public" }]);
  });
});

describe("summarizeCurrentGift", () => {
  const cd = {
    entities: [{ id: "e1", name: "ILIT" }],
    familyMembers: [{ id: "f1", firstName: "Jane", lastName: "Doe" }],
    externalBeneficiaries: [{ id: "x1", name: "Red Cross", kind: "charity", charityType: "public" }],
  } as unknown as ClientData;

  it("labels a cash gift to a trust with the trust name", () => {
    const g = { id: "g", year: 2030, amount: 15000, grantor: "client", recipientEntityId: "e1", useCrummeyPowers: false } as unknown as Gift;
    expect(summarizeCurrentGift(g, cd)).toBe("Cash gift 2030: $15,000 → ILIT");
  });

  it("labels a cash gift to a family member with their name", () => {
    const g = { id: "g", year: 2031, amount: 18000, grantor: "spouse", recipientFamilyMemberId: "f1", useCrummeyPowers: false } as unknown as Gift;
    expect(summarizeCurrentGift(g, cd)).toBe("Cash gift 2031: $18,000 → Jane Doe");
  });

  it("labels a cash gift to an external beneficiary with their name", () => {
    const g = { id: "g", year: 2032, amount: 20000, grantor: "client", recipientExternalBeneficiaryId: "x1", useCrummeyPowers: false } as unknown as Gift;
    expect(summarizeCurrentGift(g, cd)).toBe("Cash gift 2032: $20,000 → Red Cross");
  });

  it("omits the recipient suffix when no recipient is set", () => {
    const g = { id: "g", year: 2033, amount: 12000, grantor: "client", useCrummeyPowers: false } as unknown as Gift;
    expect(summarizeCurrentGift(g, cd)).toBe("Cash gift 2033: $12,000");
  });
});
