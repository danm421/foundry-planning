import { describe, expect, it } from "vitest";

import { toNumber } from "@/lib/extraction/numeric";

import { columnTotal } from "../column-totals";

/**
 * The shared coercion the totals row reads cells through. Pinned from here
 * (rather than only from `placement.ts`, its other consumer) because these are
 * the cases that decide whether a figure lands in the sum or in the "without a
 * value" disclosure beside it.
 *
 * A `+` over this field would CONCATENATE a numeric string instead of adding
 * it, which is the failure that put a 923x-wrong figure on a real plan.
 */
describe("toNumber — the rule the totals row reads cells by", () => {
  // Kills: dropping the string branch, and treating a formatted figure as
  // absent. A cell rendering "$8,618.60" must not sit above a footer claiming
  // one row has no value.
  it("takes a number, and the money shapes a loose schema lets through", () => {
    expect(toNumber(1234.5)).toBe(1234.5);
    expect(toNumber("1234.5")).toBe(1234.5);
    expect(toNumber(" 1234.5 ")).toBe(1234.5);
    expect(toNumber("$8,618.60")).toBe(8618.6);
    // Accounting negatives — a margin balance prints this way.
    expect(toNumber("(1,200.00)")).toBe(-1200);
    // A sum must never be a concatenation.
    expect(typeof toNumber("1234")).toBe("number");
  });

  // Kills: `Number("")` and `Number(null)` are both 0, so a bare `Number()`
  // call turns "this row said nothing" into "this row said zero" — the exact
  // difference the disclosure line under the total exists to report.
  it("reports an absent value as absent, never as zero", () => {
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("   ")).toBeNull();
  });

  // Kills: letting NaN into the sum, which poisons the whole figure to "$NaN",
  // and accepting exponent/hex notation as a balance.
  it("rejects a value that is not a plain figure", () => {
    expect(toNumber("SSN]")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumber("1e5")).toBeNull();
    expect(toNumber("0x10")).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber({})).toBeNull();
  });

  // A real extracted balance of zero, from a paystub that names the
  // direct-deposit account but never prints a balance.
  it("keeps a real zero", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber("0")).toBe(0);
  });
});

describe("columnTotal", () => {
  it("sums the rows carrying a figure", () => {
    const rows = [{ value: 100 }, { value: 250.5 }, { value: 49.5 }];
    expect(columnTotal(rows, "value")).toEqual({ sum: 400, missing: 0 });
  });

  // The real shape of import 93ff2c60: one row from a beneficiary .jpg with no
  // value at all, two paystub rows extracted as $0. The $0 rows are NOT
  // missing — they sum to zero correctly and show "$0" in their own cells, so
  // reporting them as missing would overstate the gap.
  it("separates a missing value from a zero one", () => {
    const rows = [
      { value: 361262.23 },
      { value: 0 },
      { value: 0 },
      { value: undefined },
    ];
    expect(columnTotal(rows, "value")).toEqual({ sum: 361262.23, missing: 1 });
  });

  // Kills: reading a hardcoded "value" key, which would silently total the
  // wrong column for any other entity table.
  it("totals the column it is asked for", () => {
    const rows = [{ value: 10, basis: 7 }, { value: 20, basis: 3 }];
    expect(columnTotal(rows, "basis").sum).toBe(10);
  });

  it("reports nothing to sum for an empty table", () => {
    expect(columnTotal([], "value")).toEqual({ sum: 0, missing: 0 });
  });

  // A margin balance can run negative; a sum that took the absolute value, or
  // floored at zero, would overstate the household.
  it("carries a negative balance into the sum", () => {
    const rows = [{ value: 1000 }, { value: -250 }];
    expect(columnTotal(rows, "value").sum).toBe(750);
  });
});
