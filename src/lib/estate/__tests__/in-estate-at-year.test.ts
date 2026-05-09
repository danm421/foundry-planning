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

describe("non-trust (business) entities", () => {
  const LLC_FAMILY = "llc-family";
  const LLC_LEGACY = "llc-legacy";

  function businessFixture(): {
    tree: ClientData;
    giftEvents: GiftEvent[];
    balances: Map<string, number>;
  } {
    const tree = {
      accounts: [
        {
          id: "acc-llc-broker",
          name: "LLC brokerage",
          category: "taxable",
          value: 500_000,
          owners: [{ kind: "entity", entityId: LLC_FAMILY, percent: 1 }],
        },
      ],
      entities: [
        {
          id: LLC_FAMILY,
          name: "Family LLC",
          entityType: "llc",
          value: 2_000_000,
          owners: [
            { familyMemberId: FM_CLIENT, percent: 0.5 },
            { familyMemberId: FM_SPOUSE, percent: 0.5 },
          ],
        },
        {
          id: LLC_LEGACY,
          name: "Legacy LLC (no owner rows)",
          entityType: "llc",
          value: 1_000_000,
          owners: undefined,
        },
      ],
    } as unknown as ClientData;
    const balances = new Map([["acc-llc-broker", 500_000]]);
    return { tree, giftEvents: [], balances };
  }

  it("treats family-owned LLC account slices as in-estate proportional to the entity's family share", () => {
    const { tree, giftEvents, balances } = businessFixture();
    // Drop the legacy LLC for this case so we only test the explicit family-owned path.
    tree.entities = tree.entities!.filter((e) => e.id === LLC_FAMILY);
    const inE = computeInEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    // Account: 100% × 500K × familyShare(1.0) = 500K in-estate; flat: 2M × 1.0 = 2M
    expect(inE).toBe(2_500_000);
    expect(outE).toBe(0);
  });

  it("includes the entity's flat value in the in-estate total proportional to family share", () => {
    const { tree, giftEvents, balances } = businessFixture();
    // Cut family share to 70% (rest is unowned — sum < 1)
    tree.entities = tree.entities!.filter((e) => e.id === LLC_FAMILY);
    tree.entities[0].owners = [
      { familyMemberId: FM_CLIENT, percent: 0.4 },
      { familyMemberId: FM_SPOUSE, percent: 0.3 },
    ];
    const inE = computeInEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    // Account slice: 500K × 0.7 = 350K; flat: 2M × 0.7 = 1.4M → in-estate 1.75M
    // Remainder (account 150K + flat 600K) → out-of-estate 750K
    expect(inE).toBeCloseTo(1_750_000, 4);
    expect(outE).toBeCloseTo(750_000, 4);
  });

  it("defaults missing owner rows to fully family-owned (legacy back-compat)", () => {
    const { tree, giftEvents, balances } = businessFixture();
    // Strip the family-owned LLC; only the legacy one with no owners[] remains.
    tree.entities = tree.entities!.filter((e) => e.id === LLC_LEGACY);
    tree.accounts = [];
    const inE = computeInEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    const outE = computeOutOfEstateAtYear({
      tree, giftEvents, year: 2026, projectionStartYear: 2026, accountBalances: balances,
    });
    // No owners[] → treat as fully in-estate (1M flat).
    expect(inE).toBe(1_000_000);
    expect(outE).toBe(0);
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
