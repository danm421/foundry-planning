import { describe, it, expect } from "vitest";
import { selectPriorDiscounts } from "../select-prior-discounts";

describe("selectPriorDiscounts", () => {
  it("keeps the discount from the latest year, whatever the list order", () => {
    // Both orders must agree — falsifies a "last one listed wins" reading that
    // ignores the year.
    const ascending = selectPriorDiscounts([
      { key: "acct-1", year: 2030, discount: 0.2 },
      { key: "acct-1", year: 2033, discount: 0.35 },
    ]);
    const descending = selectPriorDiscounts([
      { key: "acct-1", year: 2033, discount: 0.35 },
      { key: "acct-1", year: 2030, discount: 0.2 },
    ]);
    expect(ascending).toEqual({ "acct-1": 0.35 });
    expect(descending).toEqual({ "acct-1": 0.35 });
  });

  it("keeps the later-listed candidate when two share a year", () => {
    expect(
      selectPriorDiscounts([
        { key: "acct-1", year: 2030, discount: 0.2 },
        { key: "acct-1", year: 2030, discount: 0.4 },
      ]),
    ).toEqual({ "acct-1": 0.4 });
  });

  it("does NOT let a later undiscounted gift clear an earlier discount", () => {
    // The advisor who left the field blank did not mean "the discount is gone".
    expect(
      selectPriorDiscounts([
        { key: "acct-1", year: 2030, discount: 0.3 },
        { key: "acct-1", year: 2035, discount: 0 },
      ]),
    ).toEqual({ "acct-1": 0.3 });
  });

  it("never emits a key whose only candidates carry no discount", () => {
    // A zero must not surface as a prefill of "0%" — the key is simply absent.
    expect(
      selectPriorDiscounts([
        { key: "acct-1", year: 2030, discount: 0 },
        { key: "acct-2", year: 2031, discount: -0.1 },
        { key: "acct-3", year: 2032, discount: Number.NaN },
      ]),
    ).toEqual({});
  });

  it("tracks each key separately", () => {
    expect(
      selectPriorDiscounts([
        { key: "acct-1", year: 2030, discount: 0.3 },
        { key: "entity:llc-1", year: 2029, discount: 0.15 },
      ]),
    ).toEqual({ "acct-1": 0.3, "entity:llc-1": 0.15 });
  });

  it("returns an empty map for an empty list", () => {
    expect(selectPriorDiscounts([])).toEqual({});
  });
});
