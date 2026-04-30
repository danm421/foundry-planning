import { describe, expect, it } from "vitest";
import { boundedLevenshtein } from "../levenshtein";

describe("boundedLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(boundedLevenshtein("apple", "apple", 5)).toBe(0);
    expect(boundedLevenshtein("", "", 5)).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(boundedLevenshtein("kitten", "sitten", 3)).toBe(1);
  });

  it("counts a single insertion", () => {
    expect(boundedLevenshtein("cat", "cats", 3)).toBe(1);
  });

  it("counts a single deletion", () => {
    expect(boundedLevenshtein("cats", "cat", 3)).toBe(1);
  });

  it("computes a realistic typo distance", () => {
    expect(boundedLevenshtein("Schwab Brokerage", "Schwab Brokrage", 3)).toBe(1);
    expect(boundedLevenshtein("kitten", "sitting", 3)).toBe(3);
  });

  it("returns -1 when length difference alone exceeds the bound", () => {
    expect(boundedLevenshtein("a", "abc", 1)).toBe(-1);
    expect(boundedLevenshtein("abcdef", "ab", 2)).toBe(-1);
  });

  it("returns -1 when distance exceeds the bound mid-computation", () => {
    expect(boundedLevenshtein("kitten", "sitting", 2)).toBe(-1);
    expect(boundedLevenshtein("Vanguard", "Fidelity", 3)).toBe(-1);
  });

  it("returns the exact distance when it equals the bound", () => {
    expect(boundedLevenshtein("kitten", "sitting", 3)).toBe(3);
  });

  it("treats case-sensitive comparison literally (callers must lowercase)", () => {
    expect(boundedLevenshtein("Apple", "apple", 1)).toBe(1);
  });

  it("handles empty inputs against the bound", () => {
    expect(boundedLevenshtein("", "abc", 3)).toBe(3);
    expect(boundedLevenshtein("abc", "", 2)).toBe(-1);
  });

  it("supports a zero bound (exact-match check)", () => {
    expect(boundedLevenshtein("apple", "apple", 0)).toBe(0);
    expect(boundedLevenshtein("apple", "apples", 0)).toBe(-1);
  });
});
