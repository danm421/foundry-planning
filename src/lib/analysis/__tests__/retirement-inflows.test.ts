import { describe, it, expect } from "vitest";
import type { ProjectionYear, AccountLedger } from "@/engine/types";
import { retirementInflows } from "../retirement-inflows";

function ledger(rmdAmount: number): AccountLedger {
  return { rmdAmount } as AccountLedger;
}

// Minimal ProjectionYear — only the fields retirementInflows reads.
function yr(opts: {
  socialSecurity?: number;
  salaries?: number;
  business?: number;
  trust?: number;
  deferred?: number;
  capitalGains?: number;
  other?: number;
  withdrawals?: number;
  rmds?: number[];
  noteCash?: number;
  totalExpenses: number;
}): ProjectionYear {
  const income = {
    socialSecurity: opts.socialSecurity ?? 0,
    salaries: opts.salaries ?? 0,
    business: opts.business ?? 0,
    trust: opts.trust ?? 0,
    deferred: opts.deferred ?? 0,
    capitalGains: opts.capitalGains ?? 0,
    other: opts.other ?? 0,
  };
  return {
    income: { ...income, total: 0, bySource: {} },
    withdrawals: { total: opts.withdrawals ?? 0, byAccount: {} },
    totalExpenses: opts.totalExpenses,
    accountLedgers: Object.fromEntries(
      (opts.rmds ?? []).map((amt, i) => [`acct-${i}`, ledger(amt)]),
    ),
    ...(opts.noteCash != null
      ? { notesReceivableTotals: { interest: 0, principalLTCG: 0, principalBasis: 0, totalCashIn: opts.noteCash, householdCashIn: opts.noteCash } }
      : {}),
  } as ProjectionYear;
}

describe("retirementInflows", () => {
  it("breaks out every inflow band and sums them into total", () => {
    const r = retirementInflows(
      yr({
        socialSecurity: 40_000,
        salaries: 30_000,
        business: 10_000,
        trust: 5_000,
        deferred: 2_000,
        capitalGains: 3_000,
        other: 1_000,
        withdrawals: 20_000,
        rmds: [15_000, 5_000],
        totalExpenses: 100_000,
      }),
    );
    expect(r.socialSecurity).toBe(40_000);
    expect(r.salaries).toBe(30_000);
    expect(r.otherInflows).toBe(21_000); // business+trust+deferred+capGains+other
    expect(r.rmds).toBe(20_000); // 15k + 5k across ledgers
    expect(r.withdrawals).toBe(20_000);
    expect(r.total).toBe(131_000); // 40+30+21+20+20
    expect(r.shortfall).toBe(0); // total >= expenses
  });

  it("reports a positive shortfall when inflows fall short of expenses", () => {
    const r = retirementInflows(
      yr({ socialSecurity: 30_000, withdrawals: 10_000, totalExpenses: 100_000 }),
    );
    expect(r.total).toBe(40_000);
    expect(r.shortfall).toBe(60_000);
  });

  it("counts RMD cash toward coverage so it does not show a false shortfall", () => {
    // SS + withdrawals alone fall short, but RMD cash closes the gap.
    const r = retirementInflows(
      yr({
        socialSecurity: 30_000,
        withdrawals: 10_000,
        rmds: [60_000],
        totalExpenses: 100_000,
      }),
    );
    expect(r.rmds).toBe(60_000);
    expect(r.shortfall).toBe(0);
  });

  it("counts household notes-receivable cash toward coverage so it does not show a phantom shortfall", () => {
    // Note principal+interest is credited straight to checking, not income.*.
    // It must still count as an inflow or it reads as an unfunded gap.
    const r = retirementInflows(
      yr({
        socialSecurity: 30_000,
        withdrawals: 10_000,
        noteCash: 60_000,
        totalExpenses: 100_000,
      }),
    );
    expect(r.otherInflows).toBe(60_000);
    expect(r.total).toBe(100_000); // 30 + 10 + 60 note cash
    expect(r.shortfall).toBe(0);
  });

  it("never reports a negative shortfall when inflows exceed expenses", () => {
    const r = retirementInflows(
      yr({ salaries: 200_000, totalExpenses: 100_000 }),
    );
    expect(r.shortfall).toBe(0);
  });
});
