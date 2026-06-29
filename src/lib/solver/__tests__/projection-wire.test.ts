import { describe, it, expect } from "vitest";
import { mapReplacer, mapReviver } from "../projection-wire";

/** The recompute route serializes with mapReplacer; clients parse with
 *  mapReviver. ProjectionYear carries Map fields (familyAccountSharesEoY,
 *  entityAccountSharesEoY, …) that a plain JSON.stringify flattens to `{}`,
 *  which then crashes consumers doing `field?.get(...)`. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, mapReplacer), mapReviver) as T;
}

describe("projection-wire Map round-trip", () => {
  it("plain JSON.stringify loses Map entries (the bug being fixed)", () => {
    const m = new Map([["a", 1]]);
    expect(JSON.stringify(m)).toBe("{}");
  });

  it("round-trips a flat Map<string, number>", () => {
    const m = new Map<string, number>([["x", 10], ["y", 20]]);
    const out = roundTrip({ shares: m });
    expect(out.shares).toBeInstanceOf(Map);
    expect(out.shares.get("x")).toBe(10);
    expect(out.shares.get("y")).toBe(20);
  });

  it("round-trips a nested Map<string, Map<string, number>>", () => {
    const inner = new Map<string, number>([["acct-1", 500]]);
    const outer = new Map<string, Map<string, number>>([["fm-1", inner]]);
    const out = roundTrip({ familyAccountSharesEoY: outer });
    expect(out.familyAccountSharesEoY).toBeInstanceOf(Map);
    const revivedInner = out.familyAccountSharesEoY.get("fm-1");
    expect(revivedInner).toBeInstanceOf(Map);
    expect(revivedInner?.get("acct-1")).toBe(500);
  });

  it("leaves plain objects, arrays, and primitives untouched", () => {
    const value = { a: 1, b: [1, 2, 3], c: { d: "e" }, f: null };
    expect(roundTrip(value)).toEqual(value);
  });

  it("preserves a year row shape with mixed Map and scalar fields", () => {
    const year = {
      year: 2030,
      endingValue: 1234,
      familyAccountSharesEoY: new Map([["fm-1", new Map([["a-1", 5]])]]),
      entityAccountSharesEoY: undefined,
    };
    const out = roundTrip(year);
    expect(out.year).toBe(2030);
    expect(out.familyAccountSharesEoY.get("fm-1")?.get("a-1")).toBe(5);
  });
});
