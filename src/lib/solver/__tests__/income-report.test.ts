import { describe, it, expect } from "vitest";
import type { Account, ProjectionYear } from "@/engine/types";
import {
  buildIncomeReportRows,
  activeWithdrawalSources,
  WITHDRAWAL_SOURCES,
} from "../income-report";

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

// Minimal ProjectionYear factory — only the fields the income report reads.
function yr(year: number, over: Record<string, unknown>): ProjectionYear {
  return {
    year,
    ages: { client: 65 },
    income: { socialSecurity: 0, salaries: 0 },
    withdrawals: { byAccount: {}, total: 0 },
    accountLedgers: {},
    expenses: { living: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    ...over,
  } as unknown as ProjectionYear;
}

describe("buildIncomeReportRows", () => {
  it("splits the year's withdrawals by the source account's tax treatment", () => {
    const rows = buildIncomeReportRows(
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
    const rows = buildIncomeReportRows(
      [yr(2031, { withdrawals: { byAccount: { ghost: 5_000 }, total: 5_000 } })],
      ACCOUNTS,
    );

    expect(rows[0].withdrawals.taxable).toBe(5_000);
    expect(rows[0].withdrawals.preTax).toBe(0);
  });

  it("derives Other Income as the residual so the income columns sum to the engine's Total Income", () => {
    // totalIncome (91k) carries income the named columns don't name — here a
    // note-receivable cash-in that never lands in income.socialSecurity/salaries.
    const rows = buildIncomeReportRows(
      [
        yr(2031, {
          income: { socialSecurity: 30_000, salaries: 10_000 },
          accountLedgers: { ira1: { rmdAmount: 7_000 }, roth1: { rmdAmount: 0 } },
          totalIncome: 91_000,
        }),
      ],
      ACCOUNTS,
    );

    const r = rows[0];
    expect(r.rmds).toBe(7_000);
    expect(r.otherIncome).toBe(44_000);
    expect(r.socialSecurity + r.salaries + r.rmds + r.otherIncome).toBe(r.totalIncome);
  });

  it("counts only household RMDs, since entity-owned RMD cash never reaches Total Income", () => {
    // The engine stamps rmdAmount on an entity-owned account's ledger too, but
    // routes that cash to the entity's checking — it is not in totalIncome, so
    // counting it would drive the Other Income residual negative.
    const rows = buildIncomeReportRows(
      [
        yr(2031, {
          accountLedgers: {
            ira1: { rmdAmount: 40_000 },
            trustIra: { rmdAmount: 25_000 },
          },
          totalIncome: 40_000,
        }),
      ],
      [...ACCOUNTS, acct("trustIra", "retirement", "traditional_ira", ENTITY_OWNER)],
    );

    expect(rows[0].rmds).toBe(40_000);
    expect(rows[0].otherIncome).toBe(0);
  });

  it("passes the engine's own expense and net-cash-flow scalars straight through", () => {
    const rows = buildIncomeReportRows(
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
    expect(r.livingExpenses).toBe(80_000);
    expect(r.totalExpenses).toBe(110_000);
    expect(r.netCashFlow).toBe(-50_000);
    expect(r.totalIncome - r.totalExpenses).toBe(r.netCashFlow);
  });
});

describe("activeWithdrawalSources", () => {
  it("keeps only the buckets that are drawn in at least one year, in canonical order", () => {
    const rows = buildIncomeReportRows(
      [
        yr(2031, { withdrawals: { byAccount: { ira1: 8_000 }, total: 8_000 } }),
        yr(2032, { withdrawals: { byAccount: { cash1: 1_000 }, total: 1_000 } }),
      ],
      ACCOUNTS,
    );

    expect(activeWithdrawalSources(rows).map((s) => s.key)).toEqual(["cash", "preTax"]);
  });

  it("returns nothing when no year draws on the portfolio", () => {
    const rows = buildIncomeReportRows([yr(2031, {})], ACCOUNTS);
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
