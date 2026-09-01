import { describe, it, expect } from "vitest";
import type { ProjectionYear, AccountLedger } from "@/engine/types";
import { retirementInflows, isMaterialShortfall } from "../retirement-inflows";
import { fmtUsd as reportUsd } from "@/lib/presentations/pages/retirement-summary/aggregate";
import { formatCurrency as advisorUsd } from "@/components/monte-carlo/lib/format";
import { fmtUsd as portalUsd } from "@/lib/portal/format";

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

describe("isMaterialShortfall", () => {
  // The residues measured on live plans: pure float noise at 1e-11..1e-9, and
  // sub-dollar sums up to about half a dollar. Every one printed "$0".
  it("rejects the float residue a fully funded year leaves behind", () => {
    for (const n of [0, 1.4552e-11, 2.9104e-11, 5.8208e-11, 7.451e-9, 0.0096, 0.209, 0.4999]) {
      expect(isMaterialShortfall(n)).toBe(false);
    }
  });

  it("accepts a shortfall the reader can actually see", () => {
    for (const n of [0.5, 0.63, 1, 26.87, 1_565.1, 1_743_582]) {
      expect(isMaterialShortfall(n)).toBe(true);
    }
  });

  /**
   * The predicate is a hand-written threshold, not a formatter call — its
   * callers narrate a YEAR and print no dollar figure, so there is no local
   * `fmt*` to derive it from. This is what keeps it honest: every currency
   * formatter that renders a shortfall must agree with it about which amounts
   * disappear into "$0". If any of them changes its rounding, this reddens.
   */
  it("agrees with every formatter that renders a shortfall", () => {
    const amounts = [0, 1.4552e-11, 7.451e-9, 0.209, 0.4999, 0.5, 0.63, 1, 26.87, 1_565.1];
    for (const n of amounts) {
      const material = isMaterialShortfall(n);
      // The Retirement Summary's abbreviated formatter, the advisor year
      // table's full-dollar one, and the portal's Intl one.
      expect([n, reportUsd(n) !== "$0"]).toEqual([n, material]);
      expect([n, advisorUsd(n) !== "$0"]).toEqual([n, material]);
      expect([n, portalUsd(n) !== "$0"]).toEqual([n, material]);
    }
  });
});
