import { describe, it, expect } from "vitest";
import type { Account, ProjectionYear } from "@/engine/types";
import {
  buildWithdrawalReportRows,
  activeWithdrawalSources,
  WITHDRAWAL_SOURCES,
} from "../withdrawal-report";

const HOUSEHOLD_OWNER = [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }];
const ENTITY_OWNER = [{ kind: "entity", entityId: "trust-1", percent: 1 }];

function acct(
  id: string,
  category: Account["category"],
  subType: string,
  owners: unknown[] = HOUSEHOLD_OWNER,
): Account {
  return { id, category, subType, owners } as unknown as Account;
}

const ACCOUNTS = [
  acct("cash1", "cash", "savings"),
  acct("tax1", "taxable", "brokerage"),
  acct("ira1", "retirement", "traditional_ira"),
  acct("roth1", "retirement", "roth_ira"),
];

// Minimal ProjectionYear factory — only the fields the withdrawal report reads.
// Absent portfolio buckets are skipped by the weight helpers, so a bare
// `liquidTotal` is the whole snapshot for a year with nothing invested.
function yr(year: number, over: Record<string, unknown>): ProjectionYear {
  return {
    year,
    ages: { client: 65 },
    withdrawals: { byAccount: {}, total: 0 },
    accountLedgers: {},
    expenses: { living: 0 },
    portfolioAssets: { liquidTotal: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    ...over,
  } as unknown as ProjectionYear;
}

/** A year whose portfolio is one taxable account, so the BoY roll-forward and
 *  the year-1 ledger fallback both have something real to work with. */
function portfolioYear(
  year: number,
  liquidTotal: number,
  beginningValue: number,
  over: Record<string, unknown> = {},
): ProjectionYear {
  return yr(year, {
    portfolioAssets: { taxable: { tax1: liquidTotal }, liquidTotal },
    accountLedgers: {
      tax1: { rmdAmount: 0, beginningValue, endingValue: liquidTotal },
    },
    ...over,
  });
}

describe("buildWithdrawalReportRows", () => {
  it("splits the year's withdrawals by the source account's tax treatment", () => {
    const rows = buildWithdrawalReportRows(
      [
        yr(2031, {
          withdrawals: {
            byAccount: { cash1: 4_000, tax1: 6_000, ira1: 8_000, roth1: 2_000 },
            total: 20_000,
          },
        }),
      ],
      ACCOUNTS,
    );

    expect(rows[0].withdrawals).toEqual({
      cash: 4_000,
      taxable: 6_000,
      preTax: 8_000,
      roth: 2_000,
    });
    expect(rows[0].withdrawalsTotal).toBe(20_000);
  });

  it("books a draw from an account missing from the tree as taxable", () => {
    const rows = buildWithdrawalReportRows(
      [yr(2031, { withdrawals: { byAccount: { ghost: 5_000 }, total: 5_000 } })],
      ACCOUNTS,
    );

    expect(rows[0].withdrawals.taxable).toBe(5_000);
    expect(rows[0].withdrawals.preTax).toBe(0);
  });

  it("passes the engine's own income, expense and net-cash-flow scalars straight through", () => {
    const rows = buildWithdrawalReportRows(
      [
        yr(2031, {
          ages: { client: 66, spouse: 64 },
          expenses: { living: 80_000 },
          totalIncome: 60_000,
          totalExpenses: 110_000,
          netCashFlow: -50_000,
        }),
      ],
      ACCOUNTS,
    );

    const r = rows[0];
    expect(r.ages).toEqual({ client: 66, spouse: 64 });
    expect(r.totalIncome).toBe(60_000);
    expect(r.livingExpenses).toBe(80_000);
    expect(r.totalExpenses).toBe(110_000);
    expect(r.netCashFlow).toBe(-50_000);
    expect(r.totalIncome - r.totalExpenses).toBe(r.netCashFlow);
  });
});

describe("withdrawal rate", () => {
  it("divides withdrawals plus household RMDs by the prior year's portfolio", () => {
    // 2027 draws 20k and is forced out another 5k of RMD against a portfolio
    // that ended 2026 at 1M. Every figure is distinct, so a numerator that
    // forgot the RMD (2.0%) or a denominator taken from the current year
    // (2.632%) reads differently from the right answer.
    const rows = buildWithdrawalReportRows(
      [
        portfolioYear(2026, 1_000_000, 980_000),
        portfolioYear(2027, 950_000, 1_000_000, {
          withdrawals: { byAccount: { tax1: 20_000 }, total: 20_000 },
          accountLedgers: {
            tax1: { rmdAmount: 0, beginningValue: 1_000_000, endingValue: 950_000 },
            ira1: { rmdAmount: 5_000, beginningValue: 0, endingValue: 0 },
          },
        }),
      ],
      ACCOUNTS,
    );

    expect(rows[1].portfolioBoy).toBe(1_000_000);
    expect(rows[1].withdrawalRate).toBeCloseTo(0.025, 10);
  });

  it("leaves an entity-owned RMD out of the numerator", () => {
    const rows = buildWithdrawalReportRows(
      [
        portfolioYear(2026, 1_000_000, 980_000),
        portfolioYear(2027, 950_000, 1_000_000, {
          withdrawals: { byAccount: { tax1: 20_000 }, total: 20_000 },
          accountLedgers: {
            tax1: { rmdAmount: 0, beginningValue: 1_000_000, endingValue: 950_000 },
            trustIra: { rmdAmount: 30_000, beginningValue: 0, endingValue: 0 },
          },
        }),
      ],
      [...ACCOUNTS, acct("trustIra", "retirement", "traditional_ira", ENTITY_OWNER)],
    );

    // 20k / 1M, not 50k / 1M.
    expect(rows[1].withdrawalRate).toBeCloseTo(0.02, 10);
  });

  it("falls back in year 1 to the beginning value of the liquid accounts", () => {
    // No prior year to roll forward: the denominator comes off the ledgers, and
    // only the accounts that compose liquidTotal count toward it — the house has
    // a ledger too, and counting it would halve the rate.
    const rows = buildWithdrawalReportRows(
      [
        portfolioYear(2026, 800_000, 500_000, {
          withdrawals: { byAccount: { tax1: 25_000 }, total: 25_000 },
          accountLedgers: {
            tax1: { rmdAmount: 0, beginningValue: 500_000, endingValue: 800_000 },
            house: { rmdAmount: 0, beginningValue: 900_000, endingValue: 950_000 },
          },
        }),
      ],
      ACCOUNTS,
    );

    expect(rows[0].portfolioBoy).toBe(500_000);
    expect(rows[0].withdrawalRate).toBeCloseTo(0.05, 10);
  });

  it("reads zero rather than NaN when there is no portfolio to draw against", () => {
    const rows = buildWithdrawalReportRows(
      [yr(2031, { withdrawals: { byAccount: { ghost: 5_000 }, total: 5_000 } })],
      ACCOUNTS,
    );

    expect(rows[0].portfolioBoy).toBe(0);
    expect(rows[0].withdrawalRate).toBe(0);
  });
});

describe("activeWithdrawalSources", () => {
  it("keeps only the buckets that are drawn in at least one year, in canonical order", () => {
    const rows = buildWithdrawalReportRows(
      [
        yr(2031, { withdrawals: { byAccount: { ira1: 8_000 }, total: 8_000 } }),
        yr(2032, { withdrawals: { byAccount: { cash1: 1_000 }, total: 1_000 } }),
      ],
      ACCOUNTS,
    );

    expect(activeWithdrawalSources(rows).map((s) => s.key)).toEqual(["cash", "preTax"]);
  });

  it("returns nothing when no year draws on the portfolio", () => {
    const rows = buildWithdrawalReportRows([yr(2031, {})], ACCOUNTS);
    expect(activeWithdrawalSources(rows)).toEqual([]);
  });

  it("exposes a display label for every source", () => {
    expect(WITHDRAWAL_SOURCES.map((s) => s.key)).toEqual([
      "cash",
      "taxable",
      "preTax",
      "roth",
    ]);
    expect(WITHDRAWAL_SOURCES.every((s) => s.label.length > 0)).toBe(true);
  });
});
