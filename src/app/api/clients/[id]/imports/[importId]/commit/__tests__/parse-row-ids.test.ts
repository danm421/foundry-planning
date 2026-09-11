/**
 * Task 7 fix round 1, folded-in finding: C4 required the empty-array
 * behaviour be PINNED, and the committer half was (accounts-row-filter.test
 * .ts), but the route's `parseRowIds` — the only thing standing between a UI
 * that posts `rowIds: []` and this repo's logged "silent successful save
 * reads as a dead button" trap — had no test of its own. This file is that
 * test, exercising the exported function directly rather than the whole
 * POST handler.
 */
import { describe, expect, it } from "vitest";

import { parseRowIds } from "../route";

describe("parseRowIds", () => {
  it("accepts an absent rowIds as 'no filter'", () => {
    expect(parseRowIds(undefined)).toBeUndefined();
  });

  it("accepts a valid non-empty list of strings", () => {
    expect(parseRowIds(["r1", "r2"])).toEqual(["r1", "r2"]);
  });

  it("rejects an empty array", () => {
    const result = parseRowIds([]);
    expect(result).not.toBeUndefined();
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("rejects a non-array", () => {
    const result = parseRowIds("r1");
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("rejects null", () => {
    const result = parseRowIds(null);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("rejects an array with a non-string element", () => {
    const result = parseRowIds(["r1", 2]);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty("error");
  });
});
