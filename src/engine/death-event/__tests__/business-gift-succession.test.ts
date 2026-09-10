/**
 * A business interest gifted away during life must not transfer again at death.
 *
 * `applyBusinessSuccession` read the static `business.owners`, so a $100k LLC
 * gifted 15% to a trust in 2026 still handed the heirs the full $100k in 2030 —
 * $15k of it twice, once as a taxable gift and once as an inheritance. The
 * estate-transfer panel's reconciliation line ("X flows to recipients") was
 * overstated by exactly the gifted share.
 *
 * The owner SUCCESSION keeps using the authored share. `account.owners` is the
 * pre-gift baseline that `ownersForYear` re-applies gift events on top of, so
 * handing succession a gift-reduced share would leave the owners array summing
 * to less than 1 — and `ownersForYear` throws on that, taking down the whole
 * projection. The last test here pins that invariant.
 */

import { describe, it, expect } from "vitest";
import { applyBusinessSuccession, applyBusinessOwnerSuccession } from "../business-succession";
import { ownersForYear } from "../../ownership";
import type { Account, FamilyMember, GiftEvent } from "../../types";

const cooper: FamilyMember = {
  id: "fmCooper", role: "client", relationship: "other",
  firstName: "Cooper", lastName: "", dateOfBirth: "1960-01-01",
} as FamilyMember;
const spouse: FamilyMember = {
  id: "fmSpouse", role: "spouse", relationship: "other",
  firstName: "Sam", lastName: "", dateOfBirth: "1962-01-01",
} as FamilyMember;

function llcAccount(): Account {
  return {
    id: "biz-1",
    name: "Test Bus",
    category: "business",
    subType: "llc",
    value: 100_000,
    basis: 40_000,
    businessType: "llc",
    parentAccountId: null,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: "fmCooper", percent: 1 }],
  } as Account;
}

const balances = { "biz-1": 100_000 };
const basisMap = { "biz-1": 40_000 };

const GIFT_15_PCT_TO_TRUST: GiftEvent = {
  kind: "asset",
  year: 2026,
  accountId: "biz-1",
  percent: 0.15,
  grantor: "client",
  recipientEntityId: "trust-1",
  eventKind: "outright",
};

function succeed(giftEvents: GiftEvent[]) {
  return applyBusinessSuccession({
    deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
    deathOrder: 1, accounts: [llcAccount()], accountBalances: balances, basisMap,
    will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [],
    year: 2030, giftEvents, planStartYear: 2026,
  });
}

describe("business succession after a lifetime gift of the interest", () => {
  it("transfers only the share still owned at death", () => {
    const r = succeed([GIFT_15_PCT_TO_TRUST]);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].amount).toBeCloseTo(85_000, 6);
  });

  it("steps up basis on the retained share only", () => {
    const r = succeed([GIFT_15_PCT_TO_TRUST]);
    // §1014 reaches only what is in the gross estate: 85% of the flat value,
    // with the gifted 15% keeping its carryover basis.
    expect(r.basisUpdates[0]).toEqual({
      accountId: "biz-1",
      newBasis: 40_000 * 0.15 + 100_000 * 0.85,
    });
  });

  it("transfers nothing when the whole interest was gifted away", () => {
    const r = succeed([{ ...GIFT_15_PCT_TO_TRUST, percent: 1 }]);
    expect(r.transfers).toHaveLength(0);
    // Owner succession still runs — the authored row has to move off the
    // decedent regardless.
    expect(r.ownerUpdates).toHaveLength(1);
  });

  it("leaves an ungifted business transferring in full", () => {
    const r = succeed([]);
    expect(r.transfers[0].amount).toBeCloseTo(100_000, 6);
    expect(r.basisUpdates[0]).toEqual({ accountId: "biz-1", newBasis: 100_000 });
  });

  it("keeps post-death owners summing to 1 so the gift overlay still resolves", () => {
    const r = succeed([GIFT_15_PCT_TO_TRUST]);
    const [after] = applyBusinessOwnerSuccession([llcAccount()], r.ownerUpdates);

    // The authored baseline hands the survivor the full interest...
    expect(after.owners).toEqual([
      { kind: "family_member", familyMemberId: "fmSpouse", percent: 1 },
    ]);

    // ...and the gift overlay is what carves the trust's 15% back out. This
    // call throws if the baseline doesn't sum to 1.
    const resolved = ownersForYear(
      { ...after, owners: after.owners },
      [GIFT_15_PCT_TO_TRUST],
      2030,
      2026,
    );
    const trust = resolved.find((o) => o.kind === "entity");
    const survivor = resolved.find((o) => o.kind === "family_member");
    expect(trust?.percent).toBeCloseTo(0.15, 6);
    expect(survivor?.percent).toBeCloseTo(0.85, 6);
  });
});
