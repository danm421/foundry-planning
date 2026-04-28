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

  it("excludes irrevocable trust slices", () => {
    const { tree, giftEvents, balances } = fixture();
    const result = computeInEstateAtYear({
      tree,
      giftEvents,
      year: 2026,
      projectionStartYear: 2026,
      accountBalances: balances,
    });
    expect(result).toBe(2_900_000);
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
