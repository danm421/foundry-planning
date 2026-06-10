import { describe, it, expect } from "vitest";
import { buildTaxBuckets } from "./tax-buckets";
import type { Account, ProjectionYear } from "@/engine/types";

function year(
  retirement: Record<string, number>,
  ledgers: Record<string, { rothValueEoY?: number }> = {},
  totals: { cash?: number; taxable?: number } = {},
): ProjectionYear {
  return {
    portfolioAssets: {
      retirement,
      cashTotal: totals.cash ?? 0,
      taxableTotal: totals.taxable ?? 0,
    },
    accountLedgers: ledgers,
  } as unknown as ProjectionYear;
}

const acct = (id: string, subType: string): Account => ({ id, subType }) as unknown as Account;

describe("buildTaxBuckets", () => {
  it("passes cash and taxable totals straight through", () => {
    const b = buildTaxBuckets(year({}, {}, { cash: 100, taxable: 200 }), []);
    expect(b).toEqual({ cash: 100, taxable: 200, preTax: 0, roth: 0, hsa: 0 });
  });

  it("classifies traditional and SEP/SIMPLE IRAs as pre-tax", () => {
    const accounts = [acct("a", "traditional_ira"), acct("b", "sep_ira")];
    const b = buildTaxBuckets(year({ a: 500, b: 300 }), accounts);
    expect(b.preTax).toBe(800);
    expect(b.roth).toBe(0);
    expect(b.hsa).toBe(0);
  });

  it("classifies a roth_ira as roth", () => {
    const b = buildTaxBuckets(year({ r: 400 }), [acct("r", "roth_ira")]);
    expect(b.roth).toBe(400);
    expect(b.preTax).toBe(0);
  });

  it("classifies an hsa as hsa", () => {
    const b = buildTaxBuckets(year({ h: 250 }), [acct("h", "hsa")]);
    expect(b.hsa).toBe(250);
    expect(b.preTax).toBe(0);
  });

  it("splits a 401k by its Roth-designated ending portion", () => {
    const b = buildTaxBuckets(
      year({ k: 1000 }, { k: { rothValueEoY: 300 } }),
      [acct("k", "401k")],
    );
    expect(b.roth).toBe(300);
    expect(b.preTax).toBe(700);
  });

  it("treats a 401k/403b with no Roth designation as fully pre-tax", () => {
    const b = buildTaxBuckets(year({ k: 1000 }, {}), [acct("k", "403b")]);
    expect(b.preTax).toBe(1000);
    expect(b.roth).toBe(0);
  });

  it("clamps a Roth-designated portion that exceeds the account value", () => {
    const b = buildTaxBuckets(
      year({ k: 1000 }, { k: { rothValueEoY: 1200 } }),
      [acct("k", "401k")],
    );
    expect(b.roth).toBe(1000);
    expect(b.preTax).toBe(0);
  });

  it("defaults an unmatched retirement account to pre-tax", () => {
    const b = buildTaxBuckets(year({ x: 100 }), []);
    expect(b.preTax).toBe(100);
  });
});
