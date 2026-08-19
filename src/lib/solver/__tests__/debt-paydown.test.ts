import { describe, it, expect } from "vitest";
import type { Liability } from "@/engine/types";
import { buildLiabilitySchedule } from "@/engine/liability-schedules";
import {
  baseExtraPayments,
  isPaydownEligible,
  readDebtPaydown,
  resolveDebtPaydowns,
  normalizeDebtPaydownRow,
  previewDebtPaydown,
  requestedPaydownTotal,
  summarizeDebtPaydown,
  withDebtPaydown,
  type DebtPaydownRow,
} from "../debt-paydown";

/** ~$300k, 6%, 30-year mortgage originated 2020-01, current balance as of 2026-01. */
function mortgage(over: Partial<Liability> = {}): Liability {
  return {
    id: "liab-1",
    name: "Primary Mortgage",
    balance: 275_000,
    interestRate: 0.06,
    monthlyPayment: 1798.65,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    balanceAsOfYear: 2026,
    balanceAsOfMonth: 1,
    liabilityType: "mortgage",
    extraPayments: [],
    owners: [],
    ...over,
  };
}

const row = (over: Partial<DebtPaydownRow> = {}): DebtPaydownRow => ({
  liabilityId: "liab-1",
  frequency: "monthly",
  amount: 500,
  startYear: 2027,
  endYear: 2036,
  ...over,
});

const expanded = (r: DebtPaydownRow) => withDebtPaydown(mortgage(), r).extraPayments;

describe("expanding a paydown onto a loan", () => {
  it("expands a monthly plan to one per_payment row per year in the window", () => {
    const out = expanded(row({ startYear: 2027, endYear: 2029 }));
    expect(out.map((e) => e.year)).toEqual([2027, 2028, 2029]);
    expect(out.every((e) => e.type === "per_payment")).toBe(true);
    expect(out.every((e) => e.amount === 500)).toBe(true);
    expect(new Set(out.map((e) => e.id)).size).toBe(3); // unique ids
  });

  it("expands an annual plan to lump sums", () => {
    const out = expanded(row({ frequency: "annual", amount: 10_000, endYear: 2028 }));
    expect(out.map((e) => e.type)).toEqual(["lump_sum", "lump_sum"]);
  });

  it("expands a one-time plan to a single lump sum, ignoring endYear", () => {
    const out = expanded(row({ frequency: "one_time", amount: 25_000, startYear: 2027, endYear: 2040 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ year: 2027, type: "lump_sum", amount: 25_000 });
  });

  it("expands to nothing when disabled or zero", () => {
    expect(expanded(row({ enabled: false }))).toEqual([]);
    expect(expanded(row({ amount: 0 }))).toEqual([]);
  });
});

describe("baseExtraPayments / withDebtPaydown", () => {
  it("keeps advisor-entered extras and replaces only the solver's", () => {
    const handEntered = {
      id: "ep-hand",
      liabilityId: "liab-1",
      year: 2028,
      type: "lump_sum" as const,
      amount: 5_000,
    };
    const applied = withDebtPaydown(mortgage({ extraPayments: [handEntered] }), row());
    expect(applied.extraPayments.filter((e) => e.id === "ep-hand")).toHaveLength(1);

    // Re-applying against the already-applied liability must not stack.
    const reapplied = withDebtPaydown(applied, row({ amount: 900 }));
    expect(reapplied.extraPayments.filter((e) => e.id === "ep-hand")).toHaveLength(1);
    const solverRows = reapplied.extraPayments.filter((e) => e.id !== "ep-hand");
    expect(solverRows.every((e) => e.amount === 900)).toBe(true);
    expect(baseExtraPayments(reapplied)).toEqual([handEntered]);
  });
});

describe("isPaydownEligible", () => {
  it("accepts an amortizing loan with a balance", () => {
    expect(isPaydownEligible(mortgage())).toBe(true);
  });

  it("rejects a credit card (held flat — extras would be discarded)", () => {
    expect(isPaydownEligible(mortgage({ liabilityType: "credit_card" }))).toBe(false);
  });

  it("rejects a loan with no amortization term (e.g. an unlinked Plaid loan)", () => {
    expect(isPaydownEligible(mortgage({ termMonths: 0 }))).toBe(false);
  });

  it("rejects a paid-off loan", () => {
    expect(isPaydownEligible(mortgage({ balance: 0 }))).toBe(false);
  });
});

describe("previewDebtPaydown", () => {
  it("pulls the payoff year in and cuts interest", () => {
    const liab = mortgage();
    const p = previewDebtPaydown(liab, row({ amount: 500, startYear: 2027, endYear: 2049 }));
    expect(p.basePayoffYear).toBe(2049); // 360 months from 2020-01
    expect(p.newPayoffYear).not.toBeNull();
    expect(p.newPayoffYear!).toBeLessThan(p.basePayoffYear!);
    expect(p.yearsSaved).toBe(p.basePayoffYear! - p.newPayoffYear!);
    expect(p.interestSaved).toBeGreaterThan(0);
    expect(p.newInterest).toBeLessThan(p.baseInterest);
  });

  it("reports no change when there is no paydown", () => {
    const p = previewDebtPaydown(mortgage(), null);
    expect(p.newPayoffYear).toBe(p.basePayoffYear);
    expect(p.interestSaved).toBe(0);
    expect(p.appliedTotal).toBe(0);
    expect(p.capped).toBe(false);
  });

  it("never applies more than the loan — a huge one-time payment stops at the balance", () => {
    const liab = mortgage();
    const p = previewDebtPaydown(
      liab,
      row({ frequency: "one_time", amount: 5_000_000, startYear: 2027 }),
    );
    expect(p.requestedTotal).toBe(5_000_000);
    expect(p.appliedTotal).toBeLessThan(liab.balance);
    expect(p.capped).toBe(true);
    expect(p.newPayoffYear).toBe(2027);
  });

  it("stops a recurring plan the year the balance hits zero", () => {
    const liab = mortgage();
    // $4k/mo on top of the scheduled payment kills a $275k balance in a few years,
    // but the window runs to 2049.
    const p = previewDebtPaydown(liab, row({ amount: 4_000, startYear: 2027, endYear: 2049 }));
    expect(p.capped).toBe(true);
    expect(p.effectiveEndYear).toBe(p.newPayoffYear);
    expect(p.effectiveEndYear!).toBeLessThan(2049);

    // And the schedule itself emits no rows past payoff.
    const schedule = buildLiabilitySchedule(withDebtPaydown(liab, row({ amount: 4_000, startYear: 2027, endYear: 2049 })));
    expect(schedule[schedule.length - 1].endingBalance).toBe(0);
    expect(schedule.some((r) => r.year > p.newPayoffYear!)).toBe(false);
  });

  it("counts only the marginal dollars when the loan already has extras", () => {
    const handEntered = {
      id: "ep-hand",
      liabilityId: "liab-1",
      year: 2027,
      type: "lump_sum" as const,
      amount: 10_000,
    };
    const liab = mortgage({ extraPayments: [handEntered] });
    const p = previewDebtPaydown(liab, row({ frequency: "annual", amount: 6_000, startYear: 2028, endYear: 2029 }));
    expect(p.requestedTotal).toBe(12_000);
    expect(p.appliedTotal).toBeCloseTo(12_000, 0);
    expect(p.capped).toBe(false);
  });
});

describe("requestedPaydownTotal", () => {
  it("multiplies monthly amounts by 12 across the window", () => {
    expect(requestedPaydownTotal(row({ amount: 500, startYear: 2027, endYear: 2029 }))).toBe(18_000);
  });
  it("counts annual amounts once a year", () => {
    expect(
      requestedPaydownTotal(row({ frequency: "annual", amount: 5_000, startYear: 2027, endYear: 2029 })),
    ).toBe(15_000);
  });
  it("counts a one-time amount once", () => {
    expect(
      requestedPaydownTotal(row({ frequency: "one_time", amount: 25_000, startYear: 2027, endYear: 2040 })),
    ).toBe(25_000);
  });
});

describe("normalizeDebtPaydownRow", () => {
  it("caps a one-time payment at the balance standing that year", () => {
    const liab = mortgage();
    const out = normalizeDebtPaydownRow(
      liab,
      row({ frequency: "one_time", amount: 5_000_000, startYear: 2027 }),
    );
    expect(out.amount).toBeLessThanOrEqual(liab.balance);
    expect(out.amount).toBeGreaterThan(0);
    expect(out.endYear).toBe(out.startYear);
  });

  it("trims the window to the payoff year", () => {
    const out = normalizeDebtPaydownRow(mortgage(), row({ amount: 4_000, startYear: 2027, endYear: 2049 }));
    expect(out.endYear).toBeLessThan(2049);
    const p = previewDebtPaydown(mortgage(), out);
    expect(p.newPayoffYear).toBe(out.endYear);
  });

  it("leaves a window the loan can actually spend alone", () => {
    const input = row({ amount: 300, startYear: 2027, endYear: 2032 });
    expect(normalizeDebtPaydownRow(mortgage(), input)).toEqual(input);
  });

  it("never lets endYear fall below startYear", () => {
    const out = normalizeDebtPaydownRow(mortgage(), row({ startYear: 2030, endYear: 2027 }));
    expect(out.endYear).toBeGreaterThanOrEqual(out.startYear);
  });
});

describe("summarizeDebtPaydown", () => {
  it("names the cadence, the new payoff year, and the interest saved", () => {
    const liab = mortgage();
    const r = row({ amount: 500, startYear: 2027, endYear: 2049 });
    const text = summarizeDebtPaydown(r, previewDebtPaydown(liab, r));
    expect(text).toContain("$500/mo");
    expect(text).toContain("paid off");
    expect(text).toMatch(/saves \$[\d,]+/);
  });

  it("drops the payoff year once the window has been trimmed to it", () => {
    const liab = mortgage();
    const r = normalizeDebtPaydownRow(liab, row({ amount: 4_000, startYear: 2027, endYear: 2049 }));
    const text = summarizeDebtPaydown(r, previewDebtPaydown(liab, r));
    expect(text).not.toContain("paid off");
    expect(text).toContain(`2027\u2013${r.endYear}`);
  });

  it("names a one-time payment by its year", () => {
    const r = row({ frequency: "one_time", amount: 25_000, startYear: 2027 });
    expect(summarizeDebtPaydown(r, previewDebtPaydown(mortgage(), r))).toContain("$25,000 in 2027");
  });
});

describe("resolveDebtPaydowns", () => {
  const row2: DebtPaydownRow = {
    liabilityId: "liab-1",
    frequency: "monthly",
    amount: 500,
    startYear: 2027,
    endYear: 2029,
  };

  it("reads a paydown back off a tree that carries no mutation (a sourced scenario)", () => {
    const applied = withDebtPaydown(mortgage(), row2);
    expect(readDebtPaydown(applied)).toEqual(row2);
    expect(resolveDebtPaydowns([applied]).get("liab-1")).toEqual(row2);
  });

  it("round-trips each frequency", () => {
    for (const r of [
      row2,
      { ...row2, frequency: "annual" as const, amount: 6_000 },
      { ...row2, frequency: "one_time" as const, amount: 25_000, endYear: 2027 },
    ]) {
      expect(readDebtPaydown(withDebtPaydown(mortgage(), r))).toEqual(r);
    }
  });

  it("ignores advisor-entered extra payments", () => {
    const handEntered = {
      id: "ep-hand",
      liabilityId: "liab-1",
      year: 2028,
      type: "lump_sum" as const,
      amount: 5_000,
    };
    expect(readDebtPaydown(mortgage({ extraPayments: [handEntered] }))).toBeNull();
  });

  it("lets a session edit override what the tree carries, and a removal win", () => {
    const applied = withDebtPaydown(mortgage(), row2);
    const edited = resolveDebtPaydowns([applied], [
      { kind: "debt-paydown", liabilityId: "liab-1", value: { ...row2, amount: 900 } },
    ]);
    expect(edited.get("liab-1")!.amount).toBe(900);

    const removed = resolveDebtPaydowns([applied], [
      { kind: "debt-paydown", liabilityId: "liab-1", value: null },
    ]);
    expect(removed.has("liab-1")).toBe(false);
  });

  it("keeps a switched-off paydown visible even though it expands to nothing", () => {
    const off: DebtPaydownRow = { ...row2, enabled: false };
    const applied = withDebtPaydown(mortgage(), off);
    expect(applied.extraPayments).toEqual([]);
    const resolved = resolveDebtPaydowns([applied], [
      { kind: "debt-paydown", liabilityId: "liab-1", value: off },
    ]);
    expect(resolved.get("liab-1")).toEqual(off);
  });
});
