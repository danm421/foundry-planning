import { describe, it, expect } from "vitest";
import { buildAccountValueAtYear } from "../account-value-at-year";
import type { Account, AccountLedger, ProjectionYear } from "@/engine/types";

// The resolver every advisor-facing gift surface sizes and reports an in-kind
// gift with. It must read what the engine's gift ledger reads, so a top-level
// business is its CONSOLIDATED value — the parent plus every account under it.

/** Each account opens the year at half its closing value, so a test can tell
 *  which of the two a read used. */
const ledger = (endingValue: number) => ({ beginningValue: endingValue / 2, endingValue }) as AccountLedger;

/** One projection row whose ledgers hold the given ending values. */
const row = (year: number, values: Record<string, number>) =>
  ({
    year,
    accountLedgers: Object.fromEntries(
      Object.entries(values).map(([id, v]) => [id, ledger(v)]),
    ),
  }) as unknown as ProjectionYear;

const accounts = [
  { id: "biz", category: "business", parentAccountId: null },
  { id: "biz-cash", category: "cash", parentAccountId: "biz" },
  { id: "brok", category: "taxable" },
] as Account[];

const years = [
  row(2028, { biz: 100_000_000, "biz-cash": 20_000_000, brok: 400_000 }),
];

describe("buildAccountValueAtYear", () => {
  const valueAt = buildAccountValueAtYear(years, accounts);

  it("values a top-level business at the parent plus its children", () => {
    expect(valueAt("biz", 2028)).toBe(120_000_000);
  });

  it("values a plain account at its own ending balance", () => {
    expect(valueAt("brok", 2028)).toBe(400_000);
  });

  it("values a child account gifted on its own at its own balance", () => {
    expect(valueAt("biz-cash", 2028)).toBe(20_000_000);
  });

  it("returns undefined when the account has no ledger that year, or the year has no row", () => {
    expect(valueAt("not-yet-active", 2028)).toBeUndefined();
    expect(valueAt("brok", 2040)).toBeUndefined();
  });

  it("values a gift dated before the first projected year at the opening balances", () => {
    // A gift made in the skipped year of a plan that starts next year.
    expect(valueAt("brok", 2027)).toBe(200_000);
    expect(valueAt("biz", 2020)).toBe(60_000_000);
    expect(valueAt("not-yet-active", 2027)).toBeUndefined();
  });
});
