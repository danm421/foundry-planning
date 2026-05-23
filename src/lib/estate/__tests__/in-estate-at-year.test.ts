import { describe, it, expect } from "vitest";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "../in-estate-at-year";
import type { ClientData, GiftEvent } from "@/engine/types";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const TRUST_REVOC = "trust-revoc";
const TRUST_IRREVOC = "trust-irrevoc";

function fixture(): {
  tree: ClientData;
  giftEvents: GiftEvent[];
  balances: Map<string, number>;
} {
  const tree = {
    accounts: [
      {
        id: "acc-1",
        name: "Brokerage A",
        category: "taxable",
        value: 1_000_000,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.6 },
          { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.3 },
          { kind: "entity", entityId: TRUST_IRREVOC, percent: 0.1 },
        ],
      },
      {
        id: "acc-2",
        name: "Real Estate",
        category: "real_estate",
        value: 2_000_000,
        owners: [{ kind: "entity", entityId: TRUST_REVOC, percent: 1 }],
      },
    ],
    entities: [
      {
        id: TRUST_REVOC,
        name: "Revocable Trust",
        isIrrevocable: false,
        entityType: "trust",
      },
      {
        id: TRUST_IRREVOC,
        name: "SLAT",
        isIrrevocable: true,
        entityType: "trust",
      },
    ],
  } as unknown as ClientData;

  const giftEvents: GiftEvent[] = [];
  const balances = new Map([
    ["acc-1", 1_000_000],
    ["acc-2", 2_000_000],
  ]);

  return { tree, giftEvents, balances };
}

describe("computeInEstateAtYear", () => {
  it("sums family-member + revocable-trust slices", () => {
    const { tree, giftEvents, balances } = fixture();
    const result = computeInEstateAtYear({
      tree,
      giftEvents,
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });
    // acc-1: 60% (client) + 30% (spouse) = 90% × $1M = $900K (irrevocable's 10% out)
    // acc-2: 100% revocable trust = $2M
    // Total: $2.9M
    expect(result).toBe(2_900_000);
  });

  it("excludes irrevocable trust slices when the slice is large", () => {
    const { tree, giftEvents, balances } = fixture();
    // Replace acc-1 with all-irrevocable ownership.
    tree.accounts[0].owners = [
      { kind: "entity", entityId: TRUST_IRREVOC, percent: 1 },
    ];
    const result = computeInEstateAtYear({
      tree,
      giftEvents,
      year: 2026,
      accountBalances: balances,
      projectionStartYear: 2026,
    });
    // acc-1 fully irrevocable → 0; acc-2 fully revocable → $2M
    expect(result).toBe(2_000_000);
  });
});

describe("computeInEstateAtYear / computeOutOfEstateAtYear — locked entity shares", () => {
  // Bug parity with the cash-flow drilldown and estate-planning expandable cards:
  // a household-side withdrawal must NOT bleed into the entity's slice when an
  // account is split between household and an irrevocable trust. The engine
  // publishes the locked entity share via `entityAccountSharesEoY`; this
  // function must use it instead of post-withdrawal × authored percent.
  it("uses entityAccountSharesEoY so a household withdrawal doesn't drain the trust slice", () => {
    const tree = {
      accounts: [
        {
          id: "acc-mixed",
          name: "Joint+SLAT Brokerage",
          category: "taxable",
          value: 1_000_000,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.7 },
            { kind: "entity", entityId: TRUST_IRREVOC, percent: 0.3 },
          ],
        },
      ],
      entities: [
        {
          id: TRUST_IRREVOC,
          name: "SLAT",
          isIrrevocable: true,
          entityType: "trust",
        },
      ],
    } as unknown as ClientData;

    // Simulate post-withdrawal state: $1M − $79k household draw = $921k.
    const postWithdrawalBalances = new Map([["acc-mixed", 921_000]]);
    // Engine's locked entity share for the SLAT — protected from household draw.
    const entityAccountSharesEoY = new Map([
      [TRUST_IRREVOC, new Map([["acc-mixed", 300_000]])],
    ]);

    const inE = computeInEstateAtYear({
      tree,
      giftEvents: [],
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: postWithdrawalBalances,
      entityAccountSharesEoY,
    });
    const outE = computeOutOfEstateAtYear({
      tree,
      giftEvents: [],
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: postWithdrawalBalances,
      entityAccountSharesEoY,
    });

    // Out-of-estate: SLAT's locked $300k (NOT $921k × 0.3 = $276.3k).
    expect(outE).toBeCloseTo(300_000, 6);
    // In-estate: family pool = $921k − $300k = $621k (NOT $921k × 0.7 = $644.7k).
    expect(inE).toBeCloseTo(621_000, 6);
    // Sum still equals total account value (no value created or destroyed).
    expect(inE + outE).toBeCloseTo(921_000, 6);
  });
});

describe("computeOutOfEstateAtYear", () => {
  it("sums irrevocable-trust slices only", () => {
    const { tree, giftEvents, balances } = fixture();
    const result = computeOutOfEstateAtYear({
      tree,
      giftEvents,
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });
    expect(result).toBe(100_000);
  });

  it("returns 0 when no irrevocable-trust ownership", () => {
    const { tree, giftEvents, balances } = fixture();
    tree.accounts[0].owners = [
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 },
    ];
    const result = computeOutOfEstateAtYear({
      tree,
      giftEvents,
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });
    expect(result).toBe(0);
  });
});

describe("accounts with no owner rows", () => {
  // Default-checking accounts (`is_default_checking`) are created without
  // account_owners rows — they're pooled household cash. The estate
  // computation must treat them as fully in-estate, not crash.
  it("treats an account with no owner rows as fully in-estate", () => {
    const tree = {
      accounts: [
        {
          id: "acc-cash",
          name: "Household Cash",
          category: "cash",
          value: 50_000,
          owners: [],
        },
      ],
      entities: [],
    } as unknown as ClientData;
    const balances = new Map([["acc-cash", 50_000]]);

    const inE = computeInEstateAtYear({
      tree,
      giftEvents: [],
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree,
      giftEvents: [],
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });

    expect(inE).toBe(50_000);
    expect(outE).toBe(0);
  });
});

describe("business accounts (in-estate via owners + tree consolidation)", () => {
  // Post business-as-asset migration: businesses are top-level `category:
  // "business"` accounts. Their flat value lives on the account itself
  // (balances[business.id]) and is rolled up with child-account balances by
  // `consolidatedBusinessValue`. In/out-of-estate weighting then follows the
  // business account's `owners[]` — the same rule as any other account.

  function bizAccount(opts: {
    id: string;
    value: number;
    owners: Array<
      | { kind: "family_member"; familyMemberId: string; percent: number }
      | { kind: "entity"; entityId: string; percent: number }
    >;
    parentAccountId?: string | null;
    category?: "business" | "taxable" | "cash";
  }): unknown {
    return {
      id: opts.id,
      name: opts.id,
      category: opts.category ?? "business",
      subType: "llc",
      value: opts.value,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      businessType: opts.category === "business" || opts.category == null ? "llc" : null,
      parentAccountId: opts.parentAccountId ?? null,
      owners: opts.owners,
    };
  }

  it("counts a family-owned business at its consolidated value (flat + child)", () => {
    const tree = {
      accounts: [
        bizAccount({
          id: "llc-family",
          value: 2_000_000,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
          ],
        }),
        bizAccount({
          id: "acc-llc-broker",
          value: 500_000,
          owners: [],
          parentAccountId: "llc-family",
          category: "taxable",
        }),
      ],
      entities: [],
    } as unknown as ClientData;
    const balances = new Map([
      ["llc-family", 2_000_000],
      ["acc-llc-broker", 500_000],
    ]);
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    // 100% family-owned business → consolidated value $2.5M fully in-estate.
    expect(inE).toBe(2_500_000);
    expect(outE).toBe(0);
  });

  it("scales a 70% family / 30% irrevocable-trust business across flat + child", () => {
    const tree = {
      accounts: [
        bizAccount({
          id: "llc-family",
          value: 2_000_000,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.4 },
            { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.3 },
            { kind: "entity", entityId: "trust-ilit", percent: 0.3 },
          ],
        }),
        bizAccount({
          id: "acc-llc-broker",
          value: 500_000,
          owners: [],
          parentAccountId: "llc-family",
          category: "taxable",
        }),
      ],
      entities: [
        { id: "trust-ilit", name: "ILIT", entityType: "trust", isIrrevocable: true },
      ],
    } as unknown as ClientData;
    const balances = new Map([
      ["llc-family", 2_000_000],
      ["acc-llc-broker", 500_000],
    ]);
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    // Consolidated value $2.5M × 70% family = $1.75M in-estate.
    // $2.5M × 30% ILIT = $750k out-of-estate.
    expect(inE).toBeCloseTo(1_750_000, 4);
    expect(outE).toBeCloseTo(750_000, 4);
  });

  it("counts a business owned 100% by a revocable trust as fully in-estate", () => {
    // Revocable trust → grantor's estate. The business account has a trust
    // entity owner; the recursive entityInEstateWeight on the trust returns 1.
    const tree = {
      accounts: [
        bizAccount({
          id: "llc-trust-owned",
          value: 1_000_000,
          owners: [{ kind: "entity", entityId: "trust-revoc", percent: 1 }],
        }),
      ],
      entities: [
        { id: "trust-revoc", name: "Living Trust", entityType: "trust", isIrrevocable: false },
      ],
    } as unknown as ClientData;
    const balances = new Map([["llc-trust-owned", 1_000_000]]);
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    expect(inE).toBe(1_000_000);
    expect(outE).toBe(0);
  });

  it("counts a business owned 100% by an irrevocable trust as fully out-of-estate", () => {
    const tree = {
      accounts: [
        bizAccount({
          id: "llc-ilit-owned",
          value: 1_000_000,
          owners: [{ kind: "entity", entityId: "trust-ilit", percent: 1 }],
        }),
      ],
      entities: [
        { id: "trust-ilit", name: "ILIT", entityType: "trust", isIrrevocable: true },
      ],
    } as unknown as ClientData;
    const balances = new Map([["llc-ilit-owned", 1_000_000]]);
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    expect(inE).toBe(0);
    expect(outE).toBe(1_000_000);
  });

  it("splits a business co-owned 50% family + 50% irrevocable trust", () => {
    const tree = {
      accounts: [
        bizAccount({
          id: "llc-mixed",
          value: 2_000_000,
          owners: [
            { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
            { kind: "entity", entityId: "trust-ilit", percent: 0.5 },
          ],
        }),
      ],
      entities: [
        { id: "trust-ilit", name: "ILIT", entityType: "trust", isIrrevocable: true },
      ],
    } as unknown as ClientData;
    const balances = new Map([["llc-mixed", 2_000_000]]);
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    expect(inE).toBeCloseTo(1_000_000, 4);
    expect(outE).toBeCloseTo(1_000_000, 4);
  });

  it("ignores trusts and foundations in the flat-value sum", () => {
    const tree = {
      accounts: [],
      entities: [
        {
          id: "trust-a",
          name: "Revocable Trust",
          entityType: "trust",
          isIrrevocable: false,
          // value column on a trust shouldn't count — trusts hold value via accounts.
          value: 500_000,
          owners: undefined,
        },
        {
          id: "found-a",
          name: "Foundation",
          entityType: "foundation",
          value: 1_000_000,
          owners: undefined,
        },
      ],
    } as unknown as ClientData;
    const inE = computeInEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: new Map(),
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents: [], year: 2026, projectionStartYear: 2026, accountBalances: new Map(),
    });
    expect(inE).toBe(0);
    expect(outE).toBe(0);
  });
});
