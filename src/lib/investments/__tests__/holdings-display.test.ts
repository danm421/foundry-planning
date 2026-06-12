import { describe, it, expect } from "vitest";
import { toHoldingInputs, summarizeHoldings, rowChip } from "../holdings-display";
import type { HoldingRow } from "../holdings-client";

const ASSET_CLASSES = [
  { id: "ac-large", name: "US Large Cap", slug: "us_large_cap" },
  { id: "ac-bond", name: "10yr Treasury", slug: "ten_year_treasury" },
];

function row(over: Partial<HoldingRow>): HoldingRow {
  return {
    id: "h1", accountId: "a1", securityId: "s1",
    displayTicker: "VTI", displayName: "Vanguard Total",
    shares: "0", price: "0", priceAsOf: null, costBasis: "0",
    marketValue: null,
    sortOrder: 0, notes: null,
    securityWeights: [], overrides: [], needsReview: false,
    ...over,
  };
}

describe("toHoldingInputs", () => {
  it("parses string numerics into the rollup input shape", () => {
    const inputs = toHoldingInputs([
      row({ shares: "10", price: "100", costBasis: "800", securityWeights: [{ slug: "us_large_cap", weight: 1 }] }),
    ]);
    expect(inputs[0]).toMatchObject({ shares: 10, price: 100, costBasis: 800 });
    expect(inputs[0].securityWeights).toEqual([{ slug: "us_large_cap", weight: 1 }]);
  });

  it("parses a decimal-string marketValue to a number", () => {
    const inputs = toHoldingInputs([row({ marketValue: "12500.00" })]);
    expect(inputs[0].marketValue).toBe(12500);
  });
});

describe("summarizeHoldings", () => {
  it("computes value/basis and value-weighted blend named by asset class", () => {
    const rows = [
      row({ id: "h1", shares: "9", price: "100", costBasis: "500", securityWeights: [{ slug: "us_large_cap", weight: 1 }] }),
      row({ id: "h2", shares: "1", price: "100", costBasis: "100", securityWeights: [{ slug: "ten_year_treasury", weight: 1 }] }),
    ];
    const s = summarizeHoldings(rows, ASSET_CLASSES);
    expect(s.value).toBe(1000);
    expect(s.basis).toBe(600);
    expect(s.blend).toEqual([
      { assetClassId: "ac-large", name: "US Large Cap", weight: 0.9 },
      { assetClassId: "ac-bond", name: "10yr Treasury", weight: 0.1 },
    ]);
  });

  it("reports residual (unclassified) weight", () => {
    const rows = [row({ shares: "1", price: "100", securityWeights: [{ slug: "us_large_cap", weight: 0.5 }] })];
    const s = summarizeHoldings(rows, ASSET_CLASSES);
    expect(s.residual).toBeCloseTo(0.5, 6);
  });
});

describe("rowChip", () => {
  it("labels a single-class derived holding by name", () => {
    expect(rowChip(row({ securityWeights: [{ slug: "us_large_cap", weight: 1 }] }), ASSET_CLASSES))
      .toEqual({ kind: "derived", label: "US Large Cap" });
  });
  it("labels a multi-class derived holding as Blend (n)", () => {
    expect(rowChip(row({ securityWeights: [{ slug: "us_large_cap", weight: 0.6 }, { slug: "ten_year_treasury", weight: 0.4 }] }), ASSET_CLASSES))
      .toEqual({ kind: "derived", label: "Blend (2)" });
  });
  it("labels an override holding as Manual", () => {
    expect(rowChip(row({ overrides: [{ assetClassId: "ac-bond", weight: 1 }] }), ASSET_CLASSES))
      .toEqual({ kind: "manual", label: "Manual" });
  });
  it("labels a needs-review holding", () => {
    expect(rowChip(row({ securityWeights: [], overrides: [], needsReview: true }), ASSET_CLASSES))
      .toEqual({ kind: "needs_review", label: "Needs review" });
  });
});

const ASSET_CLASSES_WITH_CASH = [
  ...ASSET_CLASSES,
  { id: "ac-cash", name: "Cash", slug: "cash" },
];

describe("rowChip cash lock", () => {
  it("marks a 100% cash holding as locked", () => {
    const chip = rowChip(
      row({ securityWeights: [{ slug: "cash", weight: 1 }] }),
      ASSET_CLASSES_WITH_CASH,
    );
    expect(chip).toEqual({ kind: "locked", label: "Cash" });
  });
  it("a normal single-class holding stays derived (clickable)", () => {
    const chip = rowChip(
      row({ securityWeights: [{ slug: "us_large_cap", weight: 1 }] }),
      ASSET_CLASSES_WITH_CASH,
    );
    expect(chip.kind).toBe("derived");
  });
  it("a cash holding with a manual override stays manual (override wins)", () => {
    const chip = rowChip(
      row({
        securityWeights: [{ slug: "cash", weight: 1 }],
        overrides: [{ assetClassId: "ac-cash", weight: 1 }],
      }),
      ASSET_CLASSES_WITH_CASH,
    );
    expect(chip.kind).toBe("manual");
  });
});
