import { describe, it, expect } from "vitest";
import { planEntityGiftWrites, type EntityGiftWritesInput } from "../[entityId]/assets/gift-writes";

const BIZ = "biz-1";
const TRUST = "trust-1";

const household = [
  { id: "fm-c", role: "client" as const },
  { id: "fm-s", role: "spouse" as const },
];
const clientOnly = [{ kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }];
const fiftyFifty = [
  { kind: "family_member" as const, familyMemberId: "fm-c", percent: 0.5 },
  { kind: "family_member" as const, familyMemberId: "fm-s", percent: 0.5 },
];

/** A gift of `percent` (a FRACTION) of the $10M business to the irrevocable
 *  trust in `year`, against the given authored owners and recorded gifts. */
function addGift(
  over: Partial<Extract<EntityGiftWritesInput["op"], { op: "add" }>> = {},
  input: Partial<Omit<EntityGiftWritesInput, "op">> = {},
) {
  return planEntityGiftWrites({
    businessId: BIZ,
    businessValue: 10_000_000,
    authoredOwners: clientOnly,
    householdMembers: household,
    existingGifts: [],
    planStartYear: 2026,
    ...input,
    op: { op: "add", trustId: TRUST, trustIsIrrevocable: true, percent: 0.3, year: 2030, ...over },
  });
}

function remove(input: Partial<Omit<EntityGiftWritesInput, "op">>) {
  return planEntityGiftWrites({
    businessId: BIZ,
    businessValue: 10_000_000,
    authoredOwners: clientOnly,
    householdMembers: household,
    existingGifts: [],
    planStartYear: 2026,
    ...input,
    op: { op: "remove", trustId: TRUST },
  });
}

describe("planEntityGiftWrites — a gift to an irrevocable trust", () => {
  it("writes a gift row and leaves entity_owners UNTOUCHED", () => {
    const plan = addGift();
    expect(plan.error).toBeUndefined();
    expect(plan.ownerRowsToWrite).toBeNull(); // the baseline is not rewritten
    expect(plan.giftRowIdsToDelete).toEqual([]);
    expect(plan.giftRows).toHaveLength(1);
    expect(plan.giftRows[0]).toMatchObject({
      recipientEntityId: TRUST,
      // The loader builds the ownership overlay ONLY from rows that name the
      // business — without it the gift would move no ownership at all.
      businessEntityId: BIZ,
      grantor: "client",
      percent: "0.3000",
      year: 2030,
      eventKind: "outright",
    });
    expect(plan.appliedDebit).toBeCloseTo(0.3, 10);
  });

  it("writes one row per grantor, pro-rata, when client and spouse co-own", () => {
    const plan = addGift({}, { authoredOwners: fiftyFifty });
    expect(plan.ownerRowsToWrite).toBeNull();
    expect(plan.giftRows.map((r) => [r.grantor, r.percent, r.amount])).toEqual([
      ["client", "0.1500", "1500000.00"],
      ["spouse", "0.1500", "1500000.00"],
    ]);
  });

  it("dates the gift to the REQUESTED year, not the current calendar year", () => {
    expect(addGift({ year: 2035 }).giftRows[0].year).toBe(2035);
  });

  it("refuses a gift dated before the plan start year", () => {
    // The engine reads a gift dated before the first projection year as already
    // folded into the authored owners — and a gift writes no owner rows — so
    // it would move no ownership at all while still consuming exemption.
    const plan = addGift({ year: 2027 }, { planStartYear: 2028 });
    expect(plan.error).toMatch(/before the plan start year/i);
    expect(plan.giftRows).toHaveLength(0);
    expect(addGift({ year: 2028 }, { planStartYear: 2028 }).giftRows[0].year).toBe(2028);
  });

  it("writes the FULL undiscounted amount", () => {
    // `amount` stays the full value: the normalizer applies `valuationDiscount`
    // to it, and pre-multiplying here would double-discount.
    const plan = addGift({ valuationDiscount: 0.35 });
    expect(plan.giftRows[0].amount).toBe("3000000.00");
    expect(plan.giftRows[0].valuationDiscount).toBe("0.3500");
  });

  it("writes a NULL discount when none is given", () => {
    expect(addGift().giftRows[0].valuationDiscount).toBeNull();
  });

  it("refuses a gift larger than the authored household share", () => {
    const plan = addGift({}, {
      authoredOwners: [{ kind: "entity", entityId: "other-trust", percent: 1 }],
    });
    expect(plan.error).toMatch(/household share/i);
    expect(plan.giftRows).toHaveLength(0);
    expect(plan.ownerRowsToWrite).toBeNull();
  });

  it("refuses a gift larger than the share EARLIER GIFTS left the household", () => {
    // The client holds 50% beside an outside partner, and 0.4 is already given.
    // The AUTHORED household share (0.5) would allow 0.3; the RESOLVED one (0.1)
    // does not.
    const plan = addGift({ percent: 0.3 }, {
      authoredOwners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
        { kind: "entity", entityId: "partner-llc", percent: 0.5 },
      ],
      existingGifts: [{ id: "g-1", year: 2028, percent: 0.4, recipientEntityId: "trust-2", grantor: "client" }],
    });
    expect(plan.error).toMatch(/household share/i);
    expect(plan.giftRows).toHaveLength(0);
  });

  it("splits pro-rata against the RESOLVED household rows", () => {
    // 50/50 with 0.4 already given leaves 0.3 each; a further 0.3 fits, split
    // evenly, and 0.7 does not.
    const existingGifts = [{ id: "g-1", year: 2028, percent: 0.4, recipientEntityId: "trust-2", grantor: "client" as const }];
    const fits = addGift({ percent: 0.3 }, { authoredOwners: fiftyFifty, existingGifts });
    expect(fits.error).toBeUndefined();
    expect(fits.giftRows.map((r) => r.percent)).toEqual(["0.1500", "0.1500"]);
    expect(addGift({ percent: 0.7 }, { authoredOwners: fiftyFifty, existingGifts }).error)
      .toMatch(/household share/i);
  });

  it("counts a gift dated AFTER the new one — the engine composes them in year order", () => {
    // 0.6 already given in 2035. A 0.5 gift dated 2030 fits the 2030 household
    // share (1.0) but leaves only 0.5 for the 2035 gift, which then overdraws.
    const existingGifts = [{ id: "g-1", year: 2035, percent: 0.6, recipientEntityId: "trust-2", grantor: "client" as const }];
    const plan = addGift({ percent: 0.5, year: 2030 }, { existingGifts });
    expect(plan.error).toMatch(/household share/i);
  });

  it("can give exactly the household share that is left", () => {
    const existingGifts = [{ id: "g-1", year: 2028, percent: 0.4, recipientEntityId: "trust-2", grantor: "client" as const }];
    const plan = addGift({ percent: 0.6 }, { existingGifts });
    expect(plan.error).toBeUndefined();
    expect(plan.giftRows.map((r) => r.percent)).toEqual(["0.6000"]);
  });

  // Rounding each row on its own drifts off the request: 0.0001 : 0.9999 of a
  // 0.5 gift writes 0.0001 + 0.5000 = 0.5001 (an overdraw once nothing else is
  // left), and 0.3333 : 0.6667 writes 0.1666 + 0.3333 = 0.4999.
  it.each([
    [0.0001, 0.9999],
    [0.3333, 0.6667],
  ])("splits in whole basis points so the rows sum to exactly the request (%s : %s)", (c, s) => {
    const plan = addGift({ percent: 0.5 }, {
      authoredOwners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: c },
        { kind: "family_member", familyMemberId: "fm-s", percent: s },
      ],
    });
    const totalBp = plan.giftRows.reduce((sum, r) => sum + Math.round(Number(r.percent) * 10_000), 0);
    expect(totalBp).toBe(5_000);
  });

  it("refuses a zero-percent gift", () => {
    const plan = addGift({ percent: 0 });
    expect(plan.error).toMatch(/no share available/i);
    expect(plan.giftRows).toHaveLength(0);
  });
});

describe("planEntityGiftWrites — an assignment to a REVOCABLE trust", () => {
  it("is an authored edit: the owner rows move and no gift row is written", () => {
    const plan = addGift({ trustIsIrrevocable: false });
    expect(plan.giftRows).toEqual([]);
    expect(plan.ownerRowsToWrite).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
      { kind: "entity", entityId: TRUST, percent: 0.3 },
    ]);
  });

  it("refuses an edit that would leave recorded gifts overdrawn", () => {
    // 0.6 is already gifted to an irrevocable trust. Retitling 0.5 more to a
    // revocable trust leaves the household 0.5 — short of the 0.6 the overlay
    // must still draw, which would throw the whole projection.
    const existingGifts = [{ id: "g-1", year: 2028, percent: 0.6, recipientEntityId: "trust-2", grantor: "client" as const }];
    const plan = addGift({ trustIsIrrevocable: false, percent: 0.5 }, { existingGifts });
    expect(plan.error).toMatch(/household share/i);
    expect(plan.ownerRowsToWrite).toBeNull();
  });

  it("refuses when there is no share to retitle", () => {
    const plan = addGift({ trustIsIrrevocable: false }, { authoredOwners: [] });
    expect(plan.error).toMatch(/no share available/i);
  });
});

describe("planEntityGiftWrites — remove", () => {
  it("deletes the trust's gift rows and leaves entity_owners UNTOUCHED", () => {
    const plan = remove({
      existingGifts: [
        { id: "g-1", year: 2028, percent: 0.1, recipientEntityId: TRUST, grantor: "client" },
        { id: "g-2", year: 2029, percent: 0.2, recipientEntityId: TRUST, grantor: "spouse" },
        { id: "g-3", year: 2029, percent: 0.2, recipientEntityId: "trust-2", grantor: "client" },
      ],
    });
    expect(plan.error).toBeUndefined();
    expect(plan.giftRowIdsToDelete).toEqual(["g-1", "g-2"]);
    expect(plan.ownerRowsToWrite).toBeNull();
    expect(plan.giftRows).toEqual([]);
  });

  it("releases an AUTHORED trust row back to the household", () => {
    const plan = remove({
      authoredOwners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
        { kind: "entity", entityId: TRUST, percent: 0.4 },
      ],
    });
    expect(plan.giftRowIdsToDelete).toEqual([]);
    expect(plan.ownerRowsToWrite).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
    ]);
  });

  it("does both when the trust holds an authored row AND a gift (the legacy rewrite shape)", () => {
    const plan = remove({
      authoredOwners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
        { kind: "entity", entityId: TRUST, percent: 0.3 },
      ],
      existingGifts: [{ id: "g-1", year: 2026, percent: 0.3, recipientEntityId: TRUST, grantor: "client" }],
    });
    expect(plan.giftRowIdsToDelete).toEqual(["g-1"]);
    expect(plan.ownerRowsToWrite).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
    ]);
  });

  it("refuses when the trust holds neither", () => {
    const plan = remove({});
    expect(plan.error).toBe("Trust does not own this business");
    expect(plan.ownerRowsToWrite).toBeNull();
    expect(plan.giftRowIdsToDelete).toEqual([]);
  });
});
