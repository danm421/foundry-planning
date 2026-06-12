import { describe, it, expect } from "vitest";
import {
  pulledBlend,
  blendFromEntries,
  blendsEqual,
  formatPercent,
  parsePercent,
} from "../holding-blend";

const CLASSES = [
  { id: "id-large", slug: "us_large_cap" },
  { id: "id-cash", slug: "cash" },
  { id: "id-infl", slug: "inflation" },
  { id: "id-noslug", slug: null },
];

describe("pulledBlend", () => {
  it("maps a security's slug blend to firm asset-class ids", () => {
    const m = pulledBlend(
      [
        { slug: "us_large_cap", weight: 0.6 },
        { slug: "inflation", weight: 0.4 },
      ],
      CLASSES,
    );
    expect(m.get("id-large")).toBeCloseTo(0.6);
    expect(m.get("id-infl")).toBeCloseTo(0.4);
    expect(m.size).toBe(2);
  });

  it("drops slugs with no matching firm class (residual stays out)", () => {
    const m = pulledBlend(
      [
        { slug: "us_large_cap", weight: 0.7 },
        { slug: "unknown_slug", weight: 0.3 },
      ],
      CLASSES,
    );
    expect(m.size).toBe(1);
    expect(m.get("id-large")).toBeCloseTo(0.7);
  });

  it("drops zero/negative weights and sums duplicate slugs", () => {
    const m = pulledBlend(
      [
        { slug: "cash", weight: 0.2 },
        { slug: "cash", weight: 0.3 },
        { slug: "inflation", weight: 0 },
      ],
      CLASSES,
    );
    expect(m.get("id-cash")).toBeCloseTo(0.5);
    expect(m.has("id-infl")).toBe(false);
  });

  it("returns an empty map for an unclassified security", () => {
    expect(pulledBlend([], CLASSES).size).toBe(0);
  });
});

describe("blendFromEntries", () => {
  it("keeps positive weights and drops zeros", () => {
    const m = blendFromEntries([
      { assetClassId: "a", weight: 0.5 },
      { assetClassId: "b", weight: 0 },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("a")).toBe(0.5);
  });
});

describe("blendsEqual", () => {
  it("is true for blends that match within epsilon", () => {
    const a = new Map([["x", 0.3333]]);
    const b = new Map([["x", 0.33333]]);
    expect(blendsEqual(a, b)).toBe(true);
  });

  it("is false when a class is added or removed", () => {
    const a = new Map([["x", 1]]);
    const b = new Map([
      ["x", 0.5],
      ["y", 0.5],
    ]);
    expect(blendsEqual(a, b)).toBe(false);
  });

  it("is false when a weight differs beyond epsilon", () => {
    const a = new Map([["x", 0.6]]);
    const b = new Map([["x", 0.7]]);
    expect(blendsEqual(a, b)).toBe(false);
  });

  it("treats two empty blends as equal", () => {
    expect(blendsEqual(new Map(), new Map())).toBe(true);
  });

  it("round-trips a seeded pulled blend as unchanged", () => {
    // What the panel does: seed text from formatPercent(pulled), then re-parse.
    const pulled = new Map([
      ["a", 1 / 3],
      ["b", 2 / 3],
    ]);
    const reparsed = new Map(
      [...pulled].map(([id, w]) => [id, parsePercent(formatPercent(w))]),
    );
    expect(blendsEqual(reparsed, pulled)).toBe(true);
  });
});

describe("formatPercent / parsePercent", () => {
  it("formats fractions as percent text with trailing zeros dropped", () => {
    expect(formatPercent(1)).toBe("100");
    expect(formatPercent(0.11)).toBe("11");
    expect(formatPercent(0.115)).toBe("11.5");
  });

  it("parses percent text back to a fraction", () => {
    expect(parsePercent("100")).toBeCloseTo(1);
    expect(parsePercent("11.5")).toBeCloseTo(0.115);
  });

  it("treats blank or unparseable text as zero", () => {
    expect(parsePercent("")).toBe(0);
    expect(parsePercent(undefined)).toBe(0);
    expect(parsePercent(".")).toBe(0);
  });
});
