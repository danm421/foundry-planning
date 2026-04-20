import { describe, it, expect } from "vitest";
import { buildCorrelationMatrix, canonicalPair } from "../correlation-matrix";

describe("canonicalPair", () => {
  it("returns the sorted tuple (smaller, larger)", () => {
    expect(canonicalPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalPair("a", "b")).toEqual(["a", "b"]);
  });

  it("is identity for equal inputs", () => {
    expect(canonicalPair("x", "x")).toEqual(["x", "x"]);
  });
});

describe("buildCorrelationMatrix", () => {
  const ids = ["lc", "mc", "sc"];

  it("returns identity when no rows are supplied", () => {
    const M = buildCorrelationMatrix(ids, []);
    expect(M).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it("places supplied pairs symmetrically regardless of row ordering", () => {
    // DB rows may or may not be canonically ordered; the builder must handle both.
    const rows = [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: 0.8 },
      { assetClassIdA: "sc", assetClassIdB: "lc", correlation: 0.7 }, // reverse order
      { assetClassIdA: "mc", assetClassIdB: "sc", correlation: 0.6 },
    ];
    const M = buildCorrelationMatrix(ids, rows);
    expect(M).toEqual([
      [1.0, 0.8, 0.7],
      [0.8, 1.0, 0.6],
      [0.7, 0.6, 1.0],
    ]);
  });

  it("leaves missing pairs as 0 (independent, per PDF p.5)", () => {
    const rows = [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: 0.8 },
      // mc ↔ sc and lc ↔ sc omitted
    ];
    const M = buildCorrelationMatrix(ids, rows);
    expect(M[0][2]).toBe(0);
    expect(M[2][0]).toBe(0);
    expect(M[1][2]).toBe(0);
    expect(M[2][1]).toBe(0);
  });

  it("ignores rows referencing ids not in the requested subset", () => {
    // "used index" filtering: MC only cares about classes actually in play.
    const rows = [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: 0.8 },
      { assetClassIdA: "lc", assetClassIdB: "irrelevant", correlation: 0.9 },
    ];
    const M = buildCorrelationMatrix(ids, rows);
    expect(M[0][1]).toBe(0.8);
    // No crashes, no out-of-bounds writes.
  });

  it("parses string correlation values (Drizzle decimal columns)", () => {
    const rows = [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: "0.85" },
    ];
    const M = buildCorrelationMatrix(ids, rows);
    expect(M[0][1]).toBeCloseTo(0.85, 10);
  });

  it("rejects correlation values outside [-1, 1]", () => {
    expect(() => buildCorrelationMatrix(ids, [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: 1.5 },
    ])).toThrow(/correlation/i);

    expect(() => buildCorrelationMatrix(ids, [
      { assetClassIdA: "lc", assetClassIdB: "mc", correlation: -1.1 },
    ])).toThrow(/correlation/i);
  });

  it("handles the empty id list gracefully", () => {
    const M = buildCorrelationMatrix([], []);
    expect(M).toEqual([]);
  });
});
