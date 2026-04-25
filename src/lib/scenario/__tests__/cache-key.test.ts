// src/lib/scenario/__tests__/cache-key.test.ts
import { describe, it, expect } from "vitest";
import { hashToggleState } from "../cache-key";

describe("hashToggleState", () => {
  it("returns the same hash regardless of key order", () => {
    expect(hashToggleState({ a: true, b: false })).toBe(hashToggleState({ b: false, a: true }));
  });

  it("produces different hashes for different state", () => {
    expect(hashToggleState({ a: true })).not.toBe(hashToggleState({ a: false }));
  });

  it("returns a stable string for the empty state", () => {
    expect(hashToggleState({})).toBe(hashToggleState({}));
  });

  it("returns a deterministic hash across calls", () => {
    const h1 = hashToggleState({ a: true, b: false, c: true });
    const h2 = hashToggleState({ a: true, b: false, c: true });
    expect(h1).toBe(h2);
  });
});
