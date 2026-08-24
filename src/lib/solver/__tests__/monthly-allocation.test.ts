import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { buildMonthlyAllocation, spread } from "../monthly-allocation";

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe("buildMonthlyAllocation — reconciliation", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);

  it("emits twelve months, January through December", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0].label).toBe("January");
    expect(rows[11].label).toBe("December");
  });

  // The invariant the whole module exists to keep. Checked on EVERY year, not
  // just the first: a bug that only bites once income stops would hide in year 1.
  it("sums back to the year, per category, on every projection year", () => {
    for (const y of years) {
      const rows = buildMonthlyAllocation(y, clientData, "nominal");
      expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome, 6);
      expect(sum(rows.map((r) => r.taxes))).toBeCloseTo(y.expenses.taxes, 6);
      expect(sum(rows.map((r) => r.debt))).toBeCloseTo(y.expenses.liabilities, 6);
      expect(sum(rows.map((r) => r.savings))).toBeCloseTo(y.savings.total, 6);
      expect(sum(rows.map((r) => r.living))).toBeCloseTo(y.expenses.living, 6);
      expect(sum(rows.map((r) => r.portfolioDraw))).toBeCloseTo(y.withdrawals.total, 6);
      expect(sum(rows.map((r) => r.other))).toBeCloseTo(
        y.expenses.insurance + y.expenses.realEstate + y.expenses.other,
        6,
      );
    }
  });

  // A tolerance-based check would pass on a module that loses a cent a month, so
  // the guard is kept tight — but NOT at `toBe`. `totalIncome` and a twelve-month
  // sum are two different float associations of the same terms, and the engine
  // adds its buckets in a different order than twelve monthly additions do
  // (measured: 250000.00000000009 vs 250000). Nine places still catches a lost
  // cent by seven orders of magnitude. Exactness is asserted where it is actually
  // achievable — on `spread`, below.
  it("reconciles income to nine decimal places across rows", () => {
    const rows = buildMonthlyAllocation(years[0], clientData, "nominal");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(years[0].totalIncome, 9);
  });
});

describe("spread — the December-remainder guarantee", () => {
  // Awkward binary representations: a naive twelve-times-`total/12` loses the
  // last bits on every one of these.
  const awkward = [1_000_000 / 7, 0.1, 12_345.67, 1 / 3, 99_999.99];

  it("an even split sums back to the total EXACTLY", () => {
    for (const total of awkward) {
      expect(sum(spread(total, null))).toBe(total);
    }
  });

  it("a dated amount lands whole in its own month", () => {
    const parts = spread(1_000_000 / 7, 3);
    expect(parts[2]).toBe(1_000_000 / 7);
    expect(sum(parts)).toBe(1_000_000 / 7);
  });
});

// The residual true-up is what makes reconciliation true by construction rather
// than true by fixture. These two name the engine paths that make it necessary,
// so a future edit that deletes the true-up fails with a legible reason.
describe("buildMonthlyAllocation — the residual true-up", () => {
  it("reconciles income in an RMD year, where bySource explains less than the year", () => {
    const clientData = buildClientData();
    const years = runProjection(clientData);
    // `householdRmdIncome` is folded into `totalIncome` with no `income.bySource`
    // key of its own (projection.ts:7102). The fixture's acct-401k has
    // rmdEnabled, so the gap opens the year the client turns 75.
    const y = years.find((x) => x.year === 2045)!;
    const explained = sum(Object.values(y.income.bySource));
    expect(y.totalIncome - explained).toBeGreaterThan(90_000);

    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.income))).toBeCloseTo(y.totalIncome, 6);
  });

  it("reconciles `other` when a cash gift carries no bySource key", () => {
    const clientData = buildClientData({
      giftEvents: [
        {
          kind: "cash",
          year: 2026,
          amount: 25_000,
          grantor: "client",
          // The fixture has no checking account, so the gift needs an explicit
          // household-owned source or the engine skips it entirely.
          sourceAccountId: "acct-savings",
          useCrummeyPowers: false,
        },
      ],
    });
    const years = runProjection(clientData);
    const y = years[0];
    // `householdCashGiftsTotal` is inside `expenses.other` (projection.ts:6977)
    // with no `bySource` key at all.
    expect(y.expenses.cashGifts).toBeGreaterThan(0);

    const rows = buildMonthlyAllocation(y, clientData, "nominal");
    expect(sum(rows.map((r) => r.other))).toBeCloseTo(
      y.expenses.insurance + y.expenses.realEstate + y.expenses.other,
      6,
    );
  });
});
