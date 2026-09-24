import { describe, it, expect, vi } from "vitest";
import { giftAwareOwners, giftAwareLiabilityOwners } from "../ownership";
import type { LiabilityOwner, LiabilityWithOwners } from "../ownership";
import type { Account, GiftEvent } from "../types";

// Every "returns the authored owners" assertion below uses `toBe`, never
// `toEqual`. Both wrappers return `owners` BY REFERENCE on their early-outs,
// while `composeOwnersForYear` returns a structurally equal COPY whenever the
// overlay resolves to no net change. `toEqual` cannot tell those two apart, so
// it passes even with the guard under test deleted — identity is the contract.
//
// For the same reason every early-out case is fed a REAL in-window gift: with
// an empty gift array the `giftedPercent <= 0` early-out short-circuits first
// and the assertion stops seeing the guard it is aimed at.

const acct = (owners: Account["owners"]): Account =>
  ({ id: "acc-1", name: "A", category: "taxable", value: 0, basis: 0,
     growthRate: 0, rmdEnabled: false, owners } as unknown as Account);

const liab = (owners: LiabilityOwner[]): LiabilityWithOwners => ({ id: "liab-1", owners });

/** Fresh array per call — a shared fixture the code copied into would make the
 *  next test's identity assertion meaningless. */
const household = (): LiabilityOwner[] => [
  { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
];

const assetGift = (year: number, percent: number, accountId = "acc-1"): GiftEvent => ({
  kind: "asset", year, accountId, percent,
  grantor: "client", recipientEntityId: "trust-1",
});

const liabGift = (year: number, percent: number, liabilityId = "liab-1"): GiftEvent => ({
  kind: "liability", year, liabilityId, percent,
  grantor: "client", recipientEntityId: "trust-1", parentGiftId: "p1",
});

describe("giftAwareOwners", () => {
  it("returns authored owners when gift context is absent", () => {
    const a = acct([{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g = [assetGift(2027, 0.3)];
    expect(giftAwareOwners(a, undefined, 2030, 2026)).toBe(a.owners);
    expect(giftAwareOwners(a, g, undefined, 2026)).toBe(a.owners);
    expect(giftAwareOwners(a, g, 2030, undefined)).toBe(a.owners);
  });

  it("resolves the overlay when the household can fund the gift", () => {
    const a = acct([{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    expect(giftAwareOwners(a, [assetGift(2027, 0.3)], 2030, 2026)).toEqual([
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
    const l = liab([]);
    expect(giftAwareLiabilityOwners(l, [], 2030, 2026)).toBe(l.owners);
  });

  it("ignores a gift that targets a DIFFERENT liability", () => {
    // Two pins, because liabilityOwnersForYear re-filters by id: counting the
    // OTHER debt's gift never changes the VALUES here, it only routes the call
    // away from the early-out — into a structurally equal copy (caught by
    // `toBe`) and, on an unlinked debt with no household share to draw from,
    // into a spurious fallback warning (caught by the spy).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unrelated = [liabGift(2027, 0.5, "OTHER")];

    const l = liab(household());
    expect(giftAwareLiabilityOwners(l, unrelated, 2030, 2026)).toBe(l.owners);

    const unlinked = liab([]);
    expect(giftAwareLiabilityOwners(unlinked, unrelated, 2030, 2026)).toBe(unlinked.owners);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves a liability gift into an entity row", () => {
    const l = liab(household());
    expect(giftAwareLiabilityOwners(l, [liabGift(2027, 0.4)], 2030, 2026)).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "entity", entityId: "trust-1", percent: 0.4 },
    ]);
  });

  it("ignores a liability gift dated outside the [planStartYear, year] window", () => {
    const l = liab(household());
    expect(giftAwareLiabilityOwners(l, [liabGift(2031, 0.4)], 2030, 2026)).toBe(l.owners);
    expect(giftAwareLiabilityOwners(l, [liabGift(2025, 0.4)], 2030, 2026)).toBe(l.owners);
  });

  it("returns authored owners when gift context is absent", () => {
    const l = liab(household());
    const g = [liabGift(2027, 0.4)];
    expect(giftAwareLiabilityOwners(l, undefined, 2030, 2026)).toBe(l.owners);
    expect(giftAwareLiabilityOwners(l, g, undefined, 2026)).toBe(l.owners);
    expect(giftAwareLiabilityOwners(l, g, 2030, undefined)).toBe(l.owners);
  });
});
