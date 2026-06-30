import { describe, it, expect } from "vitest";
import {
  ownedByEntity,
  ownedByHousehold,
  ownedByFamilyMember,
  isFullyEntityOwned,
  isFullyHouseholdOwned,
  controllingFamilyMember,
  controllingEntity,
  rebalanceOwnersAfterEntityDisposition,
  ownersForYear,
  sortOwners,
  type AccountOwner,
} from "../ownership";
import type { GiftEvent } from "../types";

describe("sortOwners", () => {
  it("orders owners by (kind, id) regardless of input order", () => {
    const fmB: AccountOwner = { kind: "family_member", familyMemberId: "bbb", percent: 50 };
    const fmA: AccountOwner = { kind: "family_member", familyMemberId: "aaa", percent: 50 };
    expect(sortOwners([fmB, fmA])).toEqual([fmA, fmB]);
    // Deterministic: any input permutation serializes identically.
    expect(JSON.stringify(sortOwners([fmB, fmA]))).toBe(
      JSON.stringify(sortOwners([fmA, fmB])),
    );
  });

  it("does not mutate the input array", () => {
    const fmB: AccountOwner = { kind: "family_member", familyMemberId: "bbb", percent: 50 };
    const fmA: AccountOwner = { kind: "family_member", familyMemberId: "aaa", percent: 50 };
    const input = [fmB, fmA];
    sortOwners(input);
    expect(input).toEqual([fmB, fmA]);
  });

  it("orders across kinds deterministically", () => {
    const ent: AccountOwner = { kind: "entity", entityId: "x", percent: 50 };
    const fm: AccountOwner = { kind: "family_member", familyMemberId: "x", percent: 50 };
    expect(sortOwners([fm, ent])).toEqual(sortOwners([ent, fm]));
  });
});

const fmClient = (pct: number): AccountOwner => ({
  kind: "family_member", familyMemberId: "fm-client", percent: pct,
});
const fmSpouse = (pct: number): AccountOwner => ({
  kind: "family_member", familyMemberId: "fm-spouse", percent: pct,
});
const entTrust = (pct: number, id = "ent-trust"): AccountOwner => ({
  kind: "entity", entityId: id, percent: pct,
});

describe("ownership helpers", () => {
  it("ownedByHousehold sums all family_member rows", () => {
    expect(ownedByHousehold({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(1.0);
    expect(ownedByHousehold({ owners: [fmClient(0.6), entTrust(0.4)] })).toBeCloseTo(0.6);
    expect(ownedByHousehold({ owners: [entTrust(1.0)] })).toBe(0);
  });

  it("ownedByEntity returns matching entity row's pct or 0", () => {
    expect(ownedByEntity({ owners: [fmClient(0.5), entTrust(0.5)] }, "ent-trust")).toBe(0.5);
    expect(ownedByEntity({ owners: [entTrust(0.5, "other")] }, "ent-trust")).toBe(0);
    expect(ownedByEntity({ owners: [fmClient(1.0)] }, "ent-trust")).toBe(0);
  });

  it("ownedByFamilyMember returns matching family_member row's pct or 0", () => {
    expect(ownedByFamilyMember({ owners: [fmClient(0.7), fmSpouse(0.3)] }, "fm-client")).toBe(0.7);
    expect(ownedByFamilyMember({ owners: [entTrust(1.0)] }, "fm-client")).toBe(0);
  });

  it("isFullyEntityOwned true only when all rows are entity and sum to 1", () => {
    expect(isFullyEntityOwned({ owners: [entTrust(1.0)] })).toBe(true);
    expect(isFullyEntityOwned({ owners: [entTrust(0.5, "a"), entTrust(0.5, "b")] })).toBe(true);
    expect(isFullyEntityOwned({ owners: [entTrust(0.5), fmClient(0.5)] })).toBe(false);
    expect(isFullyEntityOwned({ owners: [fmClient(1.0)] })).toBe(false);
    expect(isFullyEntityOwned({ owners: [] })).toBe(false);
  });

  it("isFullyHouseholdOwned true only when all rows are family_member", () => {
    expect(isFullyHouseholdOwned({ owners: [fmClient(1.0)] })).toBe(true);
    expect(isFullyHouseholdOwned({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(true);
    expect(isFullyHouseholdOwned({ owners: [fmClient(0.5), entTrust(0.5)] })).toBe(false);
    expect(isFullyHouseholdOwned({ owners: [] })).toBe(false);
  });

  it("controllingFamilyMember returns the sole family_member id when there is exactly one at 100%, else null", () => {
    expect(controllingFamilyMember({ owners: [fmClient(1.0)] })).toBe("fm-client");
    expect(controllingFamilyMember({ owners: [fmClient(0.5), fmSpouse(0.5)] })).toBe(null);
    expect(controllingFamilyMember({ owners: [entTrust(1.0)] })).toBe(null);
    expect(controllingFamilyMember({ owners: [fmClient(0.7), entTrust(0.3)] })).toBe(null);
  });
});

describe("external_beneficiary owner kind", () => {
  it("contributes 0 to ownedByHousehold", () => {
    const owners: AccountOwner[] = [
      { kind: "external_beneficiary", externalBeneficiaryId: "x1", percent: 1 },
    ];
    expect(ownedByHousehold({ owners })).toBe(0);
  });

  it("makes controllingEntity and controllingFamilyMember null", () => {
    const owners: AccountOwner[] = [
      { kind: "external_beneficiary", externalBeneficiaryId: "x1", percent: 1 },
    ];
    expect(controllingEntity({ owners })).toBeNull();
    expect(controllingFamilyMember({ owners })).toBeNull();
  });

  it("isFullyEntityOwned and isFullyHouseholdOwned both return false", () => {
    const owners: AccountOwner[] = [
      { kind: "external_beneficiary", externalBeneficiaryId: "x1", percent: 1 },
    ];
    expect(isFullyEntityOwned({ owners })).toBe(false);
    expect(isFullyHouseholdOwned({ owners })).toBe(false);
  });

  it("sum-to-1 validation still passes alongside an external owner", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm1", percent: 0.5 },
      { kind: "external_beneficiary", externalBeneficiaryId: "x1", percent: 0.5 },
    ];
    expect(ownedByHousehold({ owners })).toBeCloseTo(0.5);
  });
});

describe("rebalanceOwnersAfterEntityDisposition", () => {
  it("full sale of sole entity owner returns empty array", () => {
    const owners: AccountOwner[] = [{ kind: "entity", entityId: "E1", percent: 1 }];
    expect(rebalanceOwnersAfterEntityDisposition(owners, "E1", 1)).toEqual([]);
  });

  it("full sale of 60%-owning entity scales the remaining 40% owner to 100%", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "B", percent: 0.4 },
      { kind: "entity", entityId: "E1", percent: 0.6 },
    ];
    const out = rebalanceOwnersAfterEntityDisposition(owners, "E1", 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "family_member", familyMemberId: "B", percent: 1 });
  });

  it("partial f=0.3 of p=0.6 entity: entity drops to ~0.512, other rises to ~0.488", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "B", percent: 0.4 },
      { kind: "entity", entityId: "E1", percent: 0.6 },
    ];
    const out = rebalanceOwnersAfterEntityDisposition(owners, "E1", 0.3);
    const entityRow = out.find((o) => o.kind === "entity") as { percent: number };
    const fmRow = out.find((o) => o.kind === "family_member") as { percent: number };
    expect(entityRow.percent).toBeCloseTo((0.6 * 0.7) / (1 - 0.18), 6);
    expect(fmRow.percent).toBeCloseTo(0.4 / (1 - 0.18), 6);
    expect(entityRow.percent + fmRow.percent).toBeCloseTo(1, 6);
  });

  it("preserves multiple non-entity owners proportionally", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "B", percent: 0.3 },
      { kind: "family_member", familyMemberId: "M", percent: 0.1 },
      { kind: "entity", entityId: "E1", percent: 0.6 },
    ];
    const out = rebalanceOwnersAfterEntityDisposition(owners, "E1", 1);
    expect(out).toHaveLength(2);
    const b = out.find(
      (o) => "familyMemberId" in o && o.familyMemberId === "B",
    ) as { percent: number };
    const m = out.find(
      (o) => "familyMemberId" in o && o.familyMemberId === "M",
    ) as { percent: number };
    expect(b.percent).toBeCloseTo(0.75, 6);
    expect(m.percent).toBeCloseTo(0.25, 6);
  });

  it("throws when entityId is not present in owners", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "B", percent: 1 },
    ];
    expect(() => rebalanceOwnersAfterEntityDisposition(owners, "E1", 0.5)).toThrow();
  });
});

const giftAccount = {
  id: "acct-1",
  owners: [{ kind: "family_member" as const, familyMemberId: "client", percent: 1 }],
};

describe("ownersForYear — asset gift to a non-entity recipient", () => {
  it("routes a family-member asset gift to a gifted_away owner", () => {
    const events: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acct-1", percent: 0.25, grantor: "client", recipientFamilyMemberId: "fm-kid" },
    ];
    const owners = ownersForYear(giftAccount, events, 2027, 2026);
    const gifted = owners.find((o) => o.kind === "gifted_away");
    expect(gifted).toMatchObject({ kind: "gifted_away", recipient: { kind: "family_member", id: "fm-kid" }, percent: 0.25 });
    expect(owners.reduce((s, o) => s + o.percent, 0)).toBeCloseTo(1, 9);
  });

  it("routes an external-beneficiary asset gift to a gifted_away owner", () => {
    const events: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acct-1", percent: 0.5, grantor: "client", recipientExternalBeneficiaryId: "charity-1" },
    ];
    const owners = ownersForYear(giftAccount, events, 2027, 2026);
    expect(owners.find((o) => o.kind === "gifted_away")).toMatchObject({
      recipient: { kind: "external_beneficiary", id: "charity-1" },
      percent: 0.5,
    });
  });

  it("still routes an entity asset gift to an entity owner", () => {
    const events: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acct-1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
    ];
    const owners = ownersForYear(giftAccount, events, 2027, 2026);
    expect(owners.find((o) => o.kind === "entity")).toMatchObject({ entityId: "trust-1", percent: 0.5 });
  });
});
