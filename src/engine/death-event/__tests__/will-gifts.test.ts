/**
 * The will's gifts are paid top to bottom in `sortOrder`, each taking from
 * whatever is left at its turn. A percentage gift takes X% of what's left of
 * its account (or of every account, for an estate gift). A dollar gift draws
 * from cash and brokerage only — a named account first, then (estate source or
 * the fallback box) the rest of the estate's cash and brokerage, pro-rata to
 * what each has left.
 */

import { describe, it, expect } from "vitest";
import { allocateWillGifts } from "../will-gifts";
import type { WillGiftPoolEntry, WillGiftShare } from "../will-gifts";
import type { Will, WillBequest, WillBequestRecipient } from "../../types";

const SURVIVOR = "fm-spouse";

/** A cash $100k, B brokerage $300k, H a $500k home — all wholly undisposed. */
const POOL: WillGiftPoolEntry[] = [
  { accountId: "A", category: "cash", value: 100_000, undisposed: 1 },
  { accountId: "B", category: "taxable", value: 300_000, undisposed: 1 },
  { accountId: "H", category: "real_estate", value: 500_000, undisposed: 1 },
];

function pct(recipientId: string, percentage = 100): WillBequestRecipient {
  return { recipientKind: "family_member", recipientId, percentage, sortOrder: 0 };
}

function amt(recipientId: string, amount: number): WillBequestRecipient {
  return { recipientKind: "family_member", recipientId, percentage: 0, amount, sortOrder: 0 };
}

const SPOUSE_AMT = (amount: number): WillBequestRecipient => ({
  recipientKind: "spouse", recipientId: null, percentage: 0, amount, sortOrder: 0,
});

const BASE: Omit<WillBequest, "kind" | "assetMode" | "accountId" | "percentage" | "recipients"> = {
  id: "b",
  name: "gift",
  entityId: null,
  liabilityId: null,
  condition: "always",
  sortOrder: 0,
};

function accountGift(accountId: string, percentage: number, recipients: WillBequestRecipient[]): WillBequest {
  return { ...BASE, kind: "asset", assetMode: "specific", accountId, percentage, recipients };
}

function estateGift(percentage: number, recipients: WillBequestRecipient[]): WillBequest {
  return { ...BASE, kind: "asset", assetMode: "all_assets", accountId: null, percentage, recipients };
}

function dollarGift(
  recipients: WillBequestRecipient[],
  source: { accountId?: string | null; fallbackToEstate?: boolean } = {},
): WillBequest {
  const named = "accountId" in source;
  return {
    ...BASE,
    kind: "dollar",
    assetMode: null,
    accountId: source.accountId ?? null,
    percentage: 100,
    dollarSource: named ? "account" : "estate",
    fallbackToEstate: source.fallbackToEstate ?? false,
    recipients,
  };
}

/** Gifts are listed in array order unless a test sets `sortOrder` itself. */
function inOrder(...gifts: WillBequest[]): WillBequest[] {
  return gifts.map((g, i) => ({ ...g, id: `b${i}`, sortOrder: i }));
}

function allocate(
  bequests: WillBequest[],
  opts: { pool?: WillGiftPoolEntry[]; deathOrder?: 1 | 2; survivorFmId?: string | null } = {},
): WillGiftShare[] {
  const will: Will = { id: "will", grantor: "client", bequests };
  return allocateWillGifts(
    opts.pool ?? POOL,
    will,
    opts.deathOrder ?? 1,
    opts.survivorFmId === undefined ? SURVIVOR : opts.survivorFmId,
  );
}

const who = (s: WillGiftShare) =>
  s.recipient.recipientKind === "spouse" ? "spouse" : s.recipient.recipientId;
const to = (name: string) => (s: WillGiftShare) => who(s) === name;
const isGrandchild = (s: WillGiftShare) => who(s)?.startsWith("gc") ?? false;
const on = (shares: WillGiftShare[], accountId: string) =>
  shares.filter((s) => s.accountId === accountId);
const sum = (shares: WillGiftShare[]) => shares.reduce((t, s) => t + s.fraction, 0);
const share = (shares: WillGiftShare[], accountId: string, name: string) =>
  sum(on(shares, accountId).filter(to(name)));

const GRANDKIDS_80K = dollarGift(["gc1", "gc2", "gc3", "gc4"].map((id) => amt(id, 20_000)));
const CHARITY_25 = estateGift(25, [pct("charity")]);

describe("allocateWillGifts", () => {
  it("pays $20k to each of 4 grandchildren pro-rata from cash and brokerage", () => {
    const shares = allocate(inOrder(GRANDKIDS_80K));
    // $80k of $400k cash + brokerage = 0.2 of each; A gives $20k, B gives $60k.
    for (const gc of ["gc1", "gc2", "gc3", "gc4"]) {
      expect(share(shares, "A", gc)).toBeCloseTo(0.05, 10);
      expect(share(shares, "B", gc)).toBeCloseTo(0.05, 10);
    }
    expect(on(shares, "H")).toHaveLength(0);
  });

  it("a 25% estate gift listed after the $80k gift takes 25% of what's left", () => {
    const shares = allocate(inOrder(GRANDKIDS_80K, CHARITY_25));
    expect(share(shares, "A", "charity")).toBeCloseTo(0.2, 10); // (1 − 0.2) × 0.25
    expect(share(shares, "B", "charity")).toBeCloseTo(0.2, 10);
    expect(share(shares, "H", "charity")).toBeCloseTo(0.25, 10);
  });

  it("reversing the order takes 25% first, then $80k pro-rata from what's left", () => {
    // Same array as above: sortOrder, not array position, sets the order.
    const shares = allocate([
      { ...GRANDKIDS_80K, id: "g", sortOrder: 2 },
      { ...CHARITY_25, id: "c", sortOrder: 1 },
    ]);
    expect(share(shares, "A", "charity")).toBeCloseTo(0.25, 10);
    expect(share(shares, "H", "charity")).toBeCloseTo(0.25, 10);
    // $80k of the $300k cash + brokerage left: A gives $20k of its $75k.
    expect(sum(on(shares, "A").filter(isGrandchild))).toBeCloseTo(0.2, 10);
    expect(sum(on(shares, "B").filter(isGrandchild))).toBeCloseTo(0.2, 10);
  });

  it("an account given away in full has nothing left for a later gift, not float dust", () => {
    // 1 − 0.7 − 0.3 is 5.6e-17 in floating point, not 0.
    const shares = allocate(inOrder(accountGift("A", 100, [pct("x", 70), pct("y", 30)]), CHARITY_25));
    expect(on(shares, "A").filter(to("charity"))).toHaveLength(0);
    expect(share(shares, "B", "charity")).toBeCloseTo(0.25, 10);
  });

  it("a specific % gift waits its turn: $40k first, then 100% of B to Sarah", () => {
    const shares = allocate(inOrder(dollarGift([amt("kid", 40_000)]), accountGift("B", 100, [pct("sarah")])));
    // $40k drew A $10k, B $30k → Sarah gets the 0.9 of B that's left.
    expect(share(shares, "A", "kid")).toBeCloseTo(0.1, 10);
    expect(share(shares, "B", "kid")).toBeCloseTo(0.1, 10);
    expect(share(shares, "B", "sarah")).toBeCloseTo(0.9, 10);
  });

  it("two gifts of one account compound", () => {
    const shares = allocate(inOrder(accountGift("B", 40, [pct("x")]), accountGift("B", 60, [pct("y")])));
    expect(share(shares, "B", "x")).toBeCloseTo(0.4, 10);
    expect(share(shares, "B", "y")).toBeCloseTo(0.36, 10);
    expect(sum(on(shares, "B"))).toBeCloseTo(0.76, 10); // 24% flows on
  });

  it("shortfall pays in list order, the short gift split by amounts", () => {
    const shares = allocate(
      inOrder(
        dollarGift([amt("k1", 60_000)]),
        dollarGift([amt("k2", 60_000), amt("k3", 20_000)]),
        dollarGift([amt("k4", 10_000)]),
      ),
      { pool: [POOL[0]] },
    );
    expect(share(shares, "A", "k1")).toBeCloseTo(0.6, 10);
    expect(share(shares, "A", "k2")).toBeCloseTo(0.3, 10); // $40k left, split 60:20
    expect(share(shares, "A", "k3")).toBeCloseTo(0.1, 10);
    expect(share(shares, "A", "k4")).toBe(0);
  });

  it("never draws a dollar gift from real estate", () => {
    const pool: WillGiftPoolEntry[] = [
      POOL[2],
      { accountId: "A", category: "cash", value: 10_000, undisposed: 1 },
    ];
    const shares = allocate(inOrder(dollarGift([amt("kid", 50_000)])), { pool });
    expect(share(shares, "A", "kid")).toBeCloseTo(1, 10);
    expect(on(shares, "H")).toHaveLength(0);
  });

  it("a named account without the fallback caps at its balance", () => {
    const shares = allocate(inOrder(dollarGift([amt("kid", 150_000)], { accountId: "A" })));
    expect(share(shares, "A", "kid")).toBeCloseTo(1, 10);
    expect(on(shares, "B")).toHaveLength(0);
  });

  it("a named account with the fallback spills the rest to other cash and brokerage", () => {
    const shares = allocate(
      inOrder(dollarGift([amt("kid", 150_000)], { accountId: "A", fallbackToEstate: true })),
    );
    expect(share(shares, "A", "kid")).toBeCloseTo(1, 10);
    expect(share(shares, "B", "kid")).toBeCloseTo(50_000 / 300_000, 10);
    expect(on(shares, "H")).toHaveLength(0);
  });

  it("a named account that covers the gift draws nothing from the rest", () => {
    const shares = allocate(
      inOrder(dollarGift([amt("kid", 40_000)], { accountId: "B", fallbackToEstate: true })),
    );
    expect(share(shares, "B", "kid")).toBeCloseTo(40_000 / 300_000, 10);
    expect(on(shares, "A")).toHaveLength(0);
  });

  it("a deleted named account pays from the estate when the fallback is on, else nothing", () => {
    const withFallback = allocate(
      inOrder(dollarGift([amt("kid", 100_000)], { accountId: null, fallbackToEstate: true })),
    );
    expect(share(withFallback, "A", "kid")).toBeCloseTo(0.25, 10); // $25k of A, $75k of B
    expect(share(withFallback, "B", "kid")).toBeCloseTo(0.25, 10);

    const without = allocate(inOrder(dollarGift([amt("kid", 100_000)], { accountId: null })));
    expect(without).toHaveLength(0);
  });

  it("a named account that isn't cash or brokerage behaves like a missing one", () => {
    expect(allocate(inOrder(dollarGift([amt("kid", 50_000)], { accountId: "H" })))).toHaveLength(0);
  });

  it("a gift whose condition doesn't fire is skipped and the next gift sees the full pool", () => {
    const shares = allocate(
      inOrder(
        { ...GRANDKIDS_80K, condition: "if_spouse_survives" },
        estateGift(100, [pct("heir")]),
      ),
      { deathOrder: 2, survivorFmId: null },
    );
    expect(on(shares, "A").filter(isGrandchild)).toHaveLength(0);
    expect(share(shares, "A", "heir")).toBeCloseTo(1, 10);
    expect(share(shares, "B", "heir")).toBeCloseTo(1, 10);
  });

  it("a lapsed spouse recipient's amount stays for the next gift", () => {
    const shares = allocate(
      inOrder(dollarGift([SPOUSE_AMT(20_000), amt("kid", 20_000)]), estateGift(100, [pct("heir")])),
      { deathOrder: 2, survivorFmId: null },
    );
    expect(shares.some(to("spouse"))).toBe(false);
    // The kid gets their own $20k, not the spouse's too: $5k of A, $15k of B.
    const kidA = share(shares, "A", "kid");
    expect(kidA).toBeCloseTo(0.05, 10);
    expect(kidA * 100_000 + share(shares, "B", "kid") * 300_000).toBeCloseTo(20_000, 6);
    // The heir takes everything left, the spouse's $20k included.
    expect(share(shares, "A", "heir")).toBeCloseTo(1 - kidA, 10);
    expect(share(shares, "H", "heir")).toBeCloseTo(1, 10);
  });

  it.each([0, -5_000])("a cash account worth %d produces no share and no NaN", (value) => {
    const pool: WillGiftPoolEntry[] = [
      { accountId: "A", category: "cash", value, undisposed: 1 },
      POOL[1],
    ];
    const shares = allocate(inOrder(dollarGift([amt("kid", 30_000)])), { pool });
    expect(on(shares, "A")).toHaveLength(0);
    expect(share(shares, "B", "kid")).toBeCloseTo(0.1, 10);
    expect(shares.every((s) => Number.isFinite(s.fraction) && s.fraction > 0)).toBe(true);
  });

  it("ignores liability gifts and gifts of accounts outside the pool", () => {
    const liability: WillBequest = {
      ...BASE, kind: "liability", assetMode: null, accountId: null, liabilityId: "L",
      percentage: 100, recipients: [pct("kid")],
    };
    expect(allocate(inOrder(liability, accountGift("elsewhere", 100, [pct("kid")])))).toHaveLength(0);
  });

  it("an unaffected will's fractions are bit-identical to the old arithmetic", () => {
    const pool: WillGiftPoolEntry[] = [{ ...POOL[0], undisposed: 0.7 }];
    const shares = allocate(inOrder(accountGift("A", 100, [pct("r1", 50), pct("r2", 50)])), { pool });
    expect(share(shares, "A", "r1")).toBe(0.7 * (100 / 100) * (50 / 100));
    expect(share(shares, "A", "r2")).toBe(0.7 * (100 / 100) * (50 / 100));
  });
});
