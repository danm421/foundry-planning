import { describe, it, expect } from "vitest";
import { describeConversion } from "../strategy-text";
import type { Account, RothConversion } from "@/engine/types";

const accounts = [
  { id: "ira", name: "John's IRA" },
  { id: "ira2", name: "Jane's IRA" },
  { id: "ira3", name: "John's 401(k)" },
  { id: "roth", name: "John's Roth IRA" },
] as Account[];

const conv = (over: Partial<RothConversion>): RothConversion => ({
  id: "rc",
  name: "Convert",
  destinationAccountId: "roth",
  sourceAccountIds: ["ira"],
  conversionType: "fixed_amount",
  fixedAmount: 50_000,
  startYear: 2027,
  endYear: 2034,
  indexingRate: 0,
  ...over,
});

describe("describeConversion", () => {
  it("names a fixed amount, both accounts and the years it actually ran", () => {
    expect(describeConversion(conv({}), { accounts, firstYear: 2027, lastYear: 2034 })).toBe(
      "Convert $50,000 a year from John's IRA to John's Roth IRA, 2027 through 2034.",
    );
  });

  it("says when a fixed amount grows each year", () => {
    expect(
      describeConversion(conv({ indexingRate: 0.03 }), { accounts, firstYear: 2027, lastYear: 2034 }),
    ).toBe(
      "Convert $50,000 a year from John's IRA to John's Roth IRA, 2027 through 2034, increasing 3% a year.",
    );
  });

  it("reads a single year as one year, not a range", () => {
    expect(describeConversion(conv({}), { accounts, firstYear: 2030, lastYear: 2030 })).toBe(
      "Convert $50,000 from John's IRA to John's Roth IRA in 2030.",
    );
  });

  it("joins several source accounts", () => {
    expect(
      describeConversion(conv({ sourceAccountIds: ["ira", "ira2"] }), {
        accounts,
        firstYear: 2027,
        lastYear: 2028,
      }),
    ).toContain("from John's IRA and Jane's IRA to");
  });

  it("joins three or more source accounts with a serial comma", () => {
    expect(
      describeConversion(conv({ sourceAccountIds: ["ira", "ira2", "ira3"] }), {
        accounts,
        firstYear: 2027,
        lastYear: 2028,
      }),
    ).toContain("from John's IRA, Jane's IRA, and John's 401(k) to");
  });

  it("describes a bracket fill by the bracket it fills", () => {
    expect(
      describeConversion(conv({ conversionType: "fill_up_bracket", fillUpBracket: 0.22 }), {
        accounts,
        firstYear: 2027,
        lastYear: 2034,
      }),
    ).toBe(
      "Each year from 2027 through 2034, convert just enough from John's IRA to John's Roth IRA to fill the 22% tax bracket.",
    );
  });

  it("describes a full-account conversion", () => {
    expect(
      describeConversion(conv({ conversionType: "full_account" }), {
        accounts,
        firstYear: 2030,
        lastYear: 2030,
      }),
    ).toBe("Convert the full balance of John's IRA to John's Roth IRA in 2030.");
  });

  it("describes a conversion spread over a period", () => {
    expect(
      describeConversion(conv({ conversionType: "deplete_over_period" }), {
        accounts,
        firstYear: 2027,
        lastYear: 2031,
      }),
    ).toBe(
      "Spread the conversion of John's IRA to John's Roth IRA across 2027 through 2031, so it is fully converted by 2031.",
    );
  });

  it("names the Medicare limit the conversion is held under", () => {
    const opts = { accounts, firstYear: 2027, lastYear: 2034 };
    expect(describeConversion(conv({ irmaaCapTier: 0 }), opts)).toMatch(
      /2034, without triggering a Medicare surcharge\.$/,
    );
    expect(describeConversion(conv({ irmaaCapTier: 2 }), opts)).toMatch(
      /2034, keeping any Medicare surcharge at level 2 or below\.$/,
    );
    expect(describeConversion(conv({ irmaaCapTier: null }), opts)).not.toContain("Medicare");
  });

  it("falls back to a generic name for an account the tree no longer holds", () => {
    expect(
      describeConversion(conv({ sourceAccountIds: ["gone"] }), {
        accounts,
        firstYear: 2027,
        lastYear: 2034,
      }),
    ).toContain("from a pre-tax account to");
  });
});
