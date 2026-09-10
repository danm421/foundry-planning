/**
 * A lifetime gift of a percentage of a BUSINESS must leave the gross estate.
 *
 * `computeGrossEstate` resolves every ordinary account's owners through
 * `giftAwareOwners`, so a gifted share drops out. The business-consolidation
 * loop did not: it read the static `business.owners` via
 * `deceasedBusinessAccountShare`, so a $100M LLC gifted 15% to a trust in 2026
 * still landed in the 2027 gross estate at the full $100M — while the taxable
 * gift was correctly recorded against lifetime exemption. The interest was
 * counted twice.
 */

import { describe, it, expect } from "vitest";
import { computeGrossEstate } from "../estate-tax";
import type { Account, EntitySummary, GiftEvent } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const IRREVOCABLE_TRUST: EntitySummary = {
  id: "trust-1",
  name: "New Trust",
  entityType: "trust",
  isIrrevocable: true,
  grantor: "client",
} as unknown as EntitySummary;

function business(value: number, extras: Partial<Account> = {}): Account {
  return {
    id: "biz-1",
    name: "Whatnot",
    category: "business",
    subType: "llc",
    titlingType: "jtwros",
    businessType: "llc",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    parentAccountId: null,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...extras,
  } as Account;
}

const GIFT_15_PCT_TO_TRUST: GiftEvent = {
  kind: "asset",
  year: 2026,
  accountId: "biz-1",
  percent: 0.15,
  grantor: "client",
  recipientEntityId: "trust-1",
  valuationDiscount: 0.3,
  eventKind: "outright",
};

describe("business interest gifted during life", () => {
  it("excludes the gifted share of a business from the gross estate", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [business(100_000_000)],
      accountBalances: { "biz-1": 100_000_000 },
      liabilities: [],
      entities: [IRREVOCABLE_TRUST],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      giftEvents: [GIFT_15_PCT_TO_TRUST],
      deathYear: 2027,
      planStartYear: 2026,
    });

    // 85% retained × $100M. The 15% now sits in an irrevocable trust and was
    // already charged against lifetime exemption as a taxable gift.
    expect(r.total).toBeCloseTo(85_000_000, 2);
    const bizLine = r.lines.find((l) => l.accountId === "biz-1");
    expect(bizLine).toBeDefined();
    expect(bizLine!.percentage).toBeCloseTo(0.85, 6);
    expect(bizLine!.amount).toBeCloseTo(85_000_000, 2);
  });

  it("consolidates child accounts on the retained share only", () => {
    const child = {
      ...business(0, {}),
      id: "biz-1-cash",
      name: "Whatnot — Cash",
      category: "cash",
      subType: "checking",
      businessType: null,
      parentAccountId: "biz-1",
      owners: [],
    } as Account;

    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [business(100_000_000), child],
      accountBalances: { "biz-1": 100_000_000, "biz-1-cash": 2_000_000 },
      liabilities: [],
      entities: [IRREVOCABLE_TRUST],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      giftEvents: [GIFT_15_PCT_TO_TRUST],
      deathYear: 2027,
      planStartYear: 2026,
    });

    // Consolidated $102M × 85% retained.
    expect(r.total).toBeCloseTo(86_700_000, 2);
  });

  it("leaves an ungifted business at its full consolidated value", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [business(100_000_000)],
      accountBalances: { "biz-1": 100_000_000 },
      liabilities: [],
      entities: [IRREVOCABLE_TRUST],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      giftEvents: [],
      deathYear: 2027,
      planStartYear: 2026,
    });
    expect(r.total).toBeCloseTo(100_000_000, 2);
  });

  it("ignores a gift dated after death", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [business(100_000_000)],
      accountBalances: { "biz-1": 100_000_000 },
      liabilities: [],
      entities: [IRREVOCABLE_TRUST],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      giftEvents: [{ ...GIFT_15_PCT_TO_TRUST, year: 2030 }],
      deathYear: 2027,
      planStartYear: 2026,
    });
    expect(r.total).toBeCloseTo(100_000_000, 2);
  });
});
