import { describe, it, expect } from "vitest";
import { partitionMixedAccount } from "../shared";
import { giftAwareOwners } from "../../ownership";
import type { Account, GiftEvent } from "../../types";

const savings: Account = {
  id: "aSav", name: "Savings", category: "cash", value: 0, basis: 0,
  owners: [
    { kind: "family_member", familyMemberId: "fmCooper", percent: 0.8 },
    { kind: "entity", entityId: "e1", percent: 0.2 },
  ],
} as Account;

describe("partitionMixedAccount", () => {
  it("peels the entity slice and renormalizes the family pool", () => {
    const r = partitionMixedAccount(savings, 100_000, 40_000, undefined);
    expect(r.entitySlices).toHaveLength(1);
    expect(r.entitySlices[0].value).toBe(20_000);
    expect(r.entitySlices[0].basis).toBe(8_000);
    expect(r.entitySlices[0].owners).toEqual([{ kind: "entity", entityId: "e1", percent: 1 }]);
    expect(r.entitySlices[0].id).not.toBe("aSav"); // synthetic id

    expect(r.familyPool.id).toBe("aSav"); // family pool keeps original id
    expect(r.familyPool.value).toBe(80_000);
    expect(r.familyPool.basis).toBe(32_000);
    expect(r.familyPool.owners).toEqual([
      { kind: "family_member", familyMemberId: "fmCooper", percent: 1 },
    ]);
  });

  it("prefers locked entity share when supplied", () => {
    const locked = new Map([["e1", new Map([["aSav", 25_000]])]]);
    const r = partitionMixedAccount(savings, 100_000, 40_000, locked);
    expect(r.entitySlices[0].value).toBe(25_000);
    expect(r.familyPool.value).toBe(75_000);
    // Basis fraction tracks locked value (25k/100k = 25%), not the nominal 20% percent.
    // Entity slice basis = 40_000 × 0.25 = 10_000; family pool basis = 30_000.
    expect(r.entitySlices[0].basis).toBeCloseTo(10_000, 0);
    expect(r.familyPool.basis).toBeCloseTo(30_000, 0);
  });
});

describe("partitionMixedAccount — gift-resolved ownership", () => {
  const authored = [{ kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }];
  const account = {
    id: "acc-1", name: "Brokerage", category: "taxable", value: 1_000_000,
    basis: 400_000, growthRate: 0, rmdEnabled: false, owners: authored,
  } as unknown as Account;

  it("peels a GIFTED trust slice that has no authored entity row", () => {
    const events: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    const resolved = giftAwareOwners(account, events, 2030, 2026);
    const part = partitionMixedAccount(account, 1_000_000, 400_000, undefined, resolved);
    expect(part.entitySlices).toHaveLength(1);
    expect(part.entitySlices[0].value).toBeCloseTo(300_000, 2);
    expect(part.entitySlices[0].basis).toBeCloseTo(120_000, 2);
    expect(part.familyPool.value).toBeCloseTo(700_000, 2);
  });

  it("leaves familyPool.owners AUTHORED — the pool keeps the original id", () => {
    // The pool keeps the original account id. Its owners stay the authored
    // family rows (renormalized); the chain marks the pool so later reads do
    // not apply the same gift again (`giftsReflectedThrough`).
    const events: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    const resolved = giftAwareOwners(account, events, 2030, 2026);
    const part = partitionMixedAccount(account, 1_000_000, 400_000, undefined, resolved);
    expect(part.familyPool.id).toBe("acc-1");
    expect(part.familyPool.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
    ]);
  });

  it("removes a gifted_away slice from the family pool entirely", () => {
    // Review Focus #5. A share gifted to a PERSON becomes `gifted_away` — it is
    // neither family nor entity. With no branch for it the value silently
    // stayed in the family pool, putting a gifted-away share back in the estate.
    const events: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.25, grantor: "client", recipientFamilyMemberId: "fm-kid" }];
    const resolved = giftAwareOwners(account, events, 2030, 2026);
    const part = partitionMixedAccount(account, 1_000_000, 400_000, undefined, resolved);
    expect(part.familyPool.value).toBeCloseTo(750_000, 2);
    expect(part.familyPool.basis).toBeCloseTo(300_000, 2);
    // A gifted-away slice is NOT a retained entity slice — it leaves the estate
    // and must not be pushed back onto nextAccounts.
    expect(part.entitySlices).toHaveLength(0);
  });

  it("is byte-identical to the authored behavior when resolvedOwners is omitted", () => {
    const mixed = { ...account, owners: [
      { kind: "family_member" as const, familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity" as const, entityId: "trust-1", percent: 0.2 },
    ]} as unknown as Account;
    const withParam = partitionMixedAccount(mixed, 1_000_000, 400_000, undefined, mixed.owners);
    const without = partitionMixedAccount(mixed, 1_000_000, 400_000, undefined);
    expect(withParam.familyPool.value).toBeCloseTo(without.familyPool.value, 6);
    expect(withParam.entitySlices[0].value).toBeCloseTo(without.entitySlices[0].value, 6);
  });
});
