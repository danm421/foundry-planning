import { describe, it, expect } from "vitest";
import {
  deriveModelAllocations,
  MAX_UNCLASSIFIED,
} from "@/lib/investments/derive-model-allocations";

const slugMap = { us_large_cap: "ac-stock", ten_year_treasury: "ac-bond" };

describe("deriveModelAllocations", () => {
  it("normalizes a small residual to exactly 1.0", () => {
    const res = deriveModelAllocations(
      {
        allocation: [
          { slug: "us_large_cap", weight: 0.396 },
          { slug: "ten_year_treasury", weight: 0.594 },
        ],
        unclassifiedWeight: 0.01,
      },
      slugMap,
    );
    expect(res.ok).toBe(true);
    const total = res.allocations.reduce((s, a) => s + a.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(res.allocations).toEqual(
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.4 },
        { assetClassId: "ac-bond", weight: 0.6 },
      ]),
    );
  });

  it("sums the weights of two slugs mapping to one asset class", () => {
    const res = deriveModelAllocations(
      {
        allocation: [
          { slug: "us_large_cap", weight: 0.5 },
          { slug: "us_large_cap_alt", weight: 0.5 },
        ],
        unclassifiedWeight: 0,
      },
      { us_large_cap: "ac-stock", us_large_cap_alt: "ac-stock" },
    );
    expect(res.ok).toBe(true);
    expect(res.allocations).toEqual([{ assetClassId: "ac-stock", weight: 1 }]);
  });

  it("counts a slug with no firm asset class as unclassified and names it", () => {
    const res = deriveModelAllocations(
      {
        allocation: [
          { slug: "us_large_cap", weight: 0.97 },
          { slug: "crypto", weight: 0.03 },
        ],
        unclassifiedWeight: 0,
      },
      slugMap,
    );
    expect(res.droppedSlugs).toEqual(["crypto"]);
    expect(res.unclassifiedWeight).toBeCloseTo(0.03, 10);
    expect(res.ok).toBe(true);
    expect(res.allocations).toEqual([{ assetClassId: "ac-stock", weight: 1 }]);
  });

  it("adds an unmapped slug's weight to the look-through's own residual", () => {
    // 3% never resolved to a security + 3% resolved to a slug this firm has no
    // asset class for = 6% total dilution, which is over the gate even though
    // neither half is. Judging either half alone would let it through.
    const res = deriveModelAllocations(
      {
        allocation: [
          { slug: "us_large_cap", weight: 0.94 },
          { slug: "crypto", weight: 0.03 },
        ],
        unclassifiedWeight: 0.03,
      },
      slugMap,
    );
    expect(res.unclassifiedWeight).toBeCloseTo(0.06, 10);
    expect(res.ok).toBe(false);
  });

  it("refuses when unclassified weight exceeds the gate", () => {
    const res = deriveModelAllocations(
      { allocation: [{ slug: "us_large_cap", weight: 0.9 }], unclassifiedWeight: 0.1 },
      slugMap,
    );
    expect(res.ok).toBe(false);
    expect(res.unclassifiedWeight).toBeCloseTo(0.1, 10);
    expect(res.allocations).toEqual([]);
  });

  it("accepts exactly at the gate boundary", () => {
    const res = deriveModelAllocations(
      {
        allocation: [{ slug: "us_large_cap", weight: 0.95 }],
        unclassifiedWeight: MAX_UNCLASSIFIED,
      },
      slugMap,
    );
    expect(res.ok).toBe(true);
  });

  it("refuses an empty look-through rather than emitting zero allocations", () => {
    const res = deriveModelAllocations({ allocation: [], unclassifiedWeight: 0 }, slugMap);
    expect(res.ok).toBe(false);
    expect(res.allocations).toEqual([]);
  });

  it("refuses when every slug is unmapped, even with no reported residual", () => {
    const res = deriveModelAllocations(
      { allocation: [{ slug: "crypto", weight: 1 }], unclassifiedWeight: 0 },
      slugMap,
    );
    expect(res.ok).toBe(false);
    expect(res.allocations).toEqual([]);
    expect(res.droppedSlugs).toEqual(["crypto"]);
  });
});
