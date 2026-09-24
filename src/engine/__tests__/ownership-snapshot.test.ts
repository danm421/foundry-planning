import { describe, it, expect } from "vitest";
import { buildOwnershipSnapshot } from "../ownership-snapshot";
import type { Account, GiftEvent } from "../types";

const acct = (id: string, owners: Account["owners"], extra: Partial<Account> = {}): Account =>
  ({ id, name: id, category: "taxable", value: 0, basis: 0, growthRate: 0,
     rmdEnabled: false, owners, ...extra } as unknown as Account);

const YEARS = [2026, 2027, 2028, 2029];

describe("buildOwnershipSnapshot", () => {
  it("returns authored owners for every year when no gift touches the account", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const snap = buildOwnershipSnapshot([a], [], YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt("acc-1", y)).toEqual(a.owners);
  });

  it("returns the SAME array reference for an ungifted account (no per-year clone)", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const snap = buildOwnershipSnapshot([a], [], YEARS, 2026);
    expect(snap.ownersAt("acc-1", 2026)).toBe(a.owners);
    expect(snap.ownersAt("acc-1", 2029)).toBe(a.owners);
  });

  it("flips ownership in the gift year and holds it afterwards", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2028, accountId: "acc-1",
      percent: 0.15, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    expect(snap.ownersAt("acc-1", 2027)).toEqual(a.owners);
    for (const y of [2028, 2029]) {
      expect(snap.ownersAt("acc-1", y)).toEqual([
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.85 },
        { kind: "entity", entityId: "trust-1", percent: 0.15 },
      ]);
    }
  });

  it("leaves an EMPTY owners array alone instead of throwing", () => {
    // Review Focus #1. Business children carry no account_owners rows by
    // design (the writer auto-provisions a parentAccountId-linked checking
    // child for every business). ownersForYear sums [] to 0 and throws
    // "expected 1" — which would take down the entire projection for any
    // client that owns a business.
    const child = acct("biz-cash", [], { parentAccountId: "biz-1" });
    const snap = buildOwnershipSnapshot([child], [], YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt("biz-cash", y)).toEqual([]);
  });

  it("leaves an empty owners array alone even when an unrelated gift exists", () => {
    const child = acct("biz-cash", [], { parentAccountId: "biz-1" });
    const other = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([child, other], g, YEARS, 2026);
    expect(snap.ownersAt("biz-cash", 2029)).toEqual([]);
  });

  it("leaves an EMPTY owners array alone even when a gift NAMES that account", () => {
    // Review Focus #1, the hard half: the gifted-set membership check is not
    // enough on its own. A gift that targets a business child (the estate UI
    // lets one be picked) would route it into ownersForYear, whose sum-to-1
    // validation sees 0 and throws — taking the projection down. The empty
    // guard has to sit AFTER the gifted check, not be subsumed by it.
    const child = acct("biz-cash", [], { parentAccountId: "biz-1" });
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "biz-cash",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([child], g, YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt("biz-cash", y)).toEqual([]);
  });

  it("ignores a gift dated before planStartYear — it is already in the baseline", () => {
    // Review Focus #3. Historical gifts are baked into the authored owners;
    // re-applying them double-subtracts.
    const a = acct("acc-1", [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity", entityId: "trust-1", percent: 0.2 },
    ]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2024, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    expect(snap.ownersAt("acc-1", 2029)).toEqual(a.owners);
  });

  it("APPLIES a gift dated exactly at planStartYear — the window is inclusive", () => {
    // Pins the `>=` end of the window that the pre-planStartYear case above
    // cannot see: with `e.year > planStartYear` (either here or inside
    // ownersForYear) a gift made in the plan's first year silently vanishes
    // for the whole horizon, and the authored baseline never encoded it.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2026, accountId: "acc-1",
      percent: 0.25, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    for (const y of YEARS) {
      expect(snap.ownersAt("acc-1", y)).toEqual([
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.75 },
        { kind: "entity", entityId: "trust-1", percent: 0.25 },
      ]);
    }
  });

  it("returns authored owners for an account id it has never seen", () => {
    const snap = buildOwnershipSnapshot([], [], YEARS, 2026);
    expect(snap.ownersAt("missing", 2027)).toEqual([]);
  });

  it("returns the nearest resolved year for a year outside the projection", () => {
    // Death-event years and hypothetical estate-tax years can sit outside the
    // `years` array. Clamping beats throwing.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    expect(snap.ownersAt("acc-1", 2025)).toEqual(a.owners);
    expect(snap.ownersAt("acc-1", 2099)).toEqual(snap.ownersAt("acc-1", 2029));
  });
});
