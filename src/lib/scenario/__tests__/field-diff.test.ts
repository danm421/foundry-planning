import { describe, it, expect } from "vitest";
import { editableSingletonFields, valuesEqual } from "../field-diff";

describe("valuesEqual", () => {
  it("treats a decimal string and its number as equal", () => {
    expect(valuesEqual("250000.00", 250000)).toBe(true);
  });
  it("ignores object key order", () => {
    expect(valuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
  });
  it("treats null and undefined as equal", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
  });
});

describe("editableSingletonFields", () => {
  it("drops keys neither on the base singleton nor optional", () => {
    expect(
      editableSingletonFields("plan_settings", { planEndYear: 2060 }, {
        planEndYear: 2061,
        email: "x",
        marketShock: {},
      }),
    ).toEqual({ planEndYear: 2061, marketShock: {} });
  });
  it("returns list-kind fields unchanged", () => {
    expect(editableSingletonFields("expense", undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
