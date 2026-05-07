import { describe, it, expect } from "vitest";
import { diffClutFundingPicks, type ClutFundingPick } from "../clut-funding-diff";

const ENTITY_ID = "11111111-1111-1111-1111-111111111111";
const ACCT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACCT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("diffClutFundingPicks", () => {
  it("returns no ops when original and current are identical", () => {
    const original: ClutFundingPick[] = [
      { kind: "asset", accountId: ACCT_A, percent: 1.0, existingGiftId: "g1" },
    ];
    const current: ClutFundingPick[] = [
      { kind: "asset", accountId: ACCT_A, percent: 1.0, existingGiftId: "g1" },
    ];
    const ops = diffClutFundingPicks({
      original,
      current,
      entityId: ENTITY_ID,
      year: 2026,
    });
    expect(ops).toEqual([]);
  });

  it("emits a create op for a brand-new asset pick", () => {
    const ops = diffClutFundingPicks({
      original: [],
      current: [{ kind: "asset", accountId: ACCT_A, percent: 0.5 }],
      entityId: ENTITY_ID,
      year: 2026,
      defaultAssetGrantor: "client",
    });
    expect(ops).toEqual([
      {
        type: "create",
        body: {
          year: 2026,
          grantor: "client",
          recipientEntityId: ENTITY_ID,
          accountId: ACCT_A,
          percent: 0.5,
        },
      },
    ]);
  });

  it("emits a delete op when an originally-checked pick is removed", () => {
    const ops = diffClutFundingPicks({
      original: [
        { kind: "asset", accountId: ACCT_A, percent: 1.0, existingGiftId: "g1" },
      ],
      current: [],
      entityId: ENTITY_ID,
      year: 2026,
    });
    expect(ops).toEqual([{ type: "delete", giftId: "g1" }]);
  });

  it("emits an update op when the percent on an existing asset pick changed", () => {
    const ops = diffClutFundingPicks({
      original: [
        { kind: "asset", accountId: ACCT_A, percent: 1.0, existingGiftId: "g1" },
      ],
      current: [
        { kind: "asset", accountId: ACCT_A, percent: 0.5, existingGiftId: "g1" },
      ],
      entityId: ENTITY_ID,
      year: 2026,
    });
    expect(ops).toEqual([{ type: "update", giftId: "g1", body: { percent: 0.5 } }]);
  });

  it("emits an update op when a cash pick's amount changed", () => {
    const ops = diffClutFundingPicks({
      original: [
        { kind: "cash", grantor: "client", amount: 1000, existingGiftId: "g2" },
      ],
      current: [
        { kind: "cash", grantor: "client", amount: 2500, existingGiftId: "g2" },
      ],
      entityId: ENTITY_ID,
      year: 2026,
    });
    expect(ops).toEqual([{ type: "update", giftId: "g2", body: { amount: 2500 } }]);
  });

  it("emits no op when an existing pick is unchanged", () => {
    const ops = diffClutFundingPicks({
      original: [
        { kind: "cash", grantor: "client", amount: 1000, existingGiftId: "g2" },
      ],
      current: [
        { kind: "cash", grantor: "client", amount: 1000, existingGiftId: "g2" },
      ],
      entityId: ENTITY_ID,
      year: 2026,
    });
    expect(ops).toEqual([]);
  });

  it("emits create + update + delete ops in a single diff when multiple picks change", () => {
    const original: ClutFundingPick[] = [
      { kind: "asset", accountId: ACCT_A, percent: 1.0, existingGiftId: "g1" },
      { kind: "cash", grantor: "client", amount: 1000, existingGiftId: "g2" },
    ];
    const current: ClutFundingPick[] = [
      // ACCT_A pick is removed (delete g1)
      { kind: "cash", grantor: "client", amount: 5000, existingGiftId: "g2" }, // updated amount
      { kind: "asset", accountId: ACCT_B, percent: 0.25 }, // new
    ];
    const ops = diffClutFundingPicks({
      original,
      current,
      entityId: ENTITY_ID,
      year: 2026,
      defaultAssetGrantor: "client",
    });
    // The diff function order is documented as: update, then create, then delete.
    // Assert by content using arrayContaining so callers don't depend on order.
    expect(ops).toHaveLength(3);
    expect(ops).toEqual(
      expect.arrayContaining([
        { type: "update", giftId: "g2", body: { amount: 5000 } },
        {
          type: "create",
          body: {
            year: 2026,
            grantor: "client",
            recipientEntityId: ENTITY_ID,
            accountId: ACCT_B,
            percent: 0.25,
          },
        },
        { type: "delete", giftId: "g1" },
      ]),
    );
  });
});
