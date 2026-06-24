import { describe, it, expect } from "vitest";
import {
  spendingPaceCurve,
  netThisMonth,
  dueWithinDays,
  topCategories,
} from "@/lib/portal/dashboard-summary";
import type { GroupCell } from "@/lib/portal/budget-summary";
import type { RecurringRowDTO } from "@/lib/portal/load-recurrings-data";

const JUN15 = new Date("2026-06-15T12:00:00Z"); // day 15 of a 30-day month

describe("spendingPaceCurve", () => {
  it("builds cumulative + linear pace up to today and reports under/over", () => {
    const r = spendingPaceCurve({
      dailySpend: [
        { date: "2026-06-01", amount: 100 },
        { date: "2026-06-10", amount: 200 },
        { date: "2026-06-20", amount: 999 }, // future-of-today → ignored
      ],
      totalBudget: 3000,
      now: JUN15,
    });
    expect(r.points).toHaveLength(15); // days 1..15
    expect(r.spentToDate).toBe(300);
    // pace at day 15 of 30 = 3000 * 15/30 = 1500; under by 1500 - 300
    expect(r.points[14].pace).toBe(1500);
    expect(r.underBy).toBe(1200);
  });

  it("nets refunds (negative amounts) down", () => {
    const r = spendingPaceCurve({
      dailySpend: [
        { date: "2026-06-02", amount: 500 },
        { date: "2026-06-03", amount: -100 },
      ],
      totalBudget: 0,
      now: JUN15,
    });
    expect(r.spentToDate).toBe(400);
  });
});

describe("netThisMonth", () => {
  it("computes net, prior, and signed deltas", () => {
    const r = netThisMonth({ income: 5000, spent: 4000, priorIncome: 5000, priorSpent: 3000 });
    expect(r.net).toBe(1000);
    expect(r.prior).toBe(2000);
    expect(r.deltaAbs).toBe(-1000);
    expect(r.deltaPct).toBe(-50);
  });
  it("returns null deltaPct when prior is zero", () => {
    expect(netThisMonth({ income: 100, spent: 0, priorIncome: 0, priorSpent: 0 }).deltaPct).toBeNull();
  });
});

function rec(over: Partial<RecurringRowDTO>): RecurringRowDTO {
  return {
    id: "r", name: "Bill", cadence: "monthly", dueDay: 20, dueMonth: null,
    categoryId: "c", predicted: 50, state: "due", postedThisMonth: 0, ...over,
  };
}

describe("dueWithinDays", () => {
  it("includes a monthly bill due within the window", () => {
    const out = dueWithinDays([rec({ dueDay: 20 })], JUN15, 14); // due Jun 20, 5 days out
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe("2026-06-20");
    expect(out[0].daysUntil).toBe(5);
  });
  it("excludes a bill beyond the window", () => {
    expect(dueWithinDays([rec({ dueDay: 28 })], JUN15, 7)).toHaveLength(0); // 13 days out
  });
  it("includes overdue bills with the passed due date", () => {
    const out = dueWithinDays([rec({ dueDay: 5, state: "overdue" })], JUN15, 14);
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe("2026-06-05");
    expect(out[0].daysUntil).toBe(-10);
  });
  it("skips recurrings with no dueDay", () => {
    expect(dueWithinDays([rec({ dueDay: null })], JUN15, 14)).toHaveLength(0);
  });
  it("rolls an annual bill to next year when this year's date has passed", () => {
    const out = dueWithinDays(
      [rec({ cadence: "annually", dueMonth: 1, dueDay: 10 })], JUN15, 14,
    );
    expect(out).toHaveLength(0); // Jan 10 next year is far away
  });
});

function grp(over: Partial<GroupCell>): GroupCell {
  return {
    id: "g", name: "G", slug: null, color: "var(--data-blue)", budget: 100,
    budgetIsExplicit: true, actual: 0, remaining: 100, leaves: [], ...over,
  };
}

describe("topCategories", () => {
  it("returns the top-N spend groups, descending, dropping zero-spend", () => {
    const out = topCategories(
      [grp({ id: "a", actual: 10 }), grp({ id: "b", actual: 50 }), grp({ id: "c", actual: 0 })],
      2,
    );
    expect(out.map((g) => g.id)).toEqual(["b", "a"]);
  });
});
