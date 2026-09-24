import { describe, it, expect, vi } from "vitest";
import { giftAwareOwners, giftAwareLiabilityOwners } from "../ownership";
import type { Account, GiftEvent } from "../types";

const acct = (owners: Account["owners"]): Account =>
  ({ id: "acc-1", name: "A", category: "taxable", value: 0, basis: 0,
     growthRate: 0, rmdEnabled: false, owners } as unknown as Account);

describe("giftAwareOwners", () => {
  it("returns authored owners when gift context is absent", () => {
    const a = acct([{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    expect(giftAwareOwners(a, undefined, 2030, 2026)).toBe(a.owners);
    expect(giftAwareOwners(a, [], undefined, 2026)).toBe(a.owners);
    expect(giftAwareOwners(a, [], 2030, undefined)).toBe(a.owners);
  });

  it("resolves the overlay when the household can fund the gift", () => {
    const a = acct([{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    expect(giftAwareOwners(a, g, 2030, 2026)).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
      { kind: "entity", entityId: "trust-1", percent: 0.3 },
    ]);
  });

  it("falls back to authored owners when the gift cannot be drawn — AND warns", () => {
    // The ILIT case: the policy is already modeled entity-owned and carries a
    // redundant gift event for the §2035 / ATG line. Falling back is correct;
    // doing it SILENTLY is how a double-applied overlay hides.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = acct([{ kind: "entity", entityId: "ilit-1", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 1, grantor: "client", recipientEntityId: "ilit-1" }];
    expect(giftAwareOwners(a, g, 2030, 2026)).toBe(a.owners);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("acc-1");
    warn.mockRestore();
  });
});

describe("giftAwareLiabilityOwners", () => {
  it("returns owners untouched for an unlinked debt with an EMPTY owners array", () => {
    // Review Focus #1. A bare liabilityOwnersForYear on this throws
    // "sum to 0, expected 1" — the early-out is what makes the twin usable.
    const l = { id: "liab-1", owners: [] };
    expect(giftAwareLiabilityOwners(l, [], 2030, 2026)).toEqual([]);
    const unrelated: GiftEvent[] = [{ kind: "liability", year: 2027,
      liabilityId: "OTHER", percent: 0.5, grantor: "client",
      recipientEntityId: "trust-1", parentGiftId: "p1" }];
    expect(giftAwareLiabilityOwners(l, unrelated, 2030, 2026)).toEqual([]);
  });

  it("resolves a liability gift into an entity row", () => {
    const l = { id: "liab-1", owners: [
      { kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }] };
    const g: GiftEvent[] = [{ kind: "liability", year: 2027, liabilityId: "liab-1",
      percent: 0.4, grantor: "client", recipientEntityId: "trust-1", parentGiftId: "p1" }];
    expect(giftAwareLiabilityOwners(l, g, 2030, 2026)).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "entity", entityId: "trust-1", percent: 0.4 },
    ]);
  });

  it("ignores a liability gift dated after the requested year", () => {
    const l = { id: "liab-1", owners: [
      { kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }] };
    const g: GiftEvent[] = [{ kind: "liability", year: 2031, liabilityId: "liab-1",
      percent: 0.4, grantor: "client", recipientEntityId: "trust-1", parentGiftId: "p1" }];
    expect(giftAwareLiabilityOwners(l, g, 2030, 2026)).toEqual(l.owners);
  });

  it("returns authored owners when gift context is absent", () => {
    const l = { id: "liab-1", owners: [
      { kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }] };
    expect(giftAwareLiabilityOwners(l, undefined, 2030, 2026)).toBe(l.owners);
  });
});
