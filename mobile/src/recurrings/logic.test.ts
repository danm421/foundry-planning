// mobile/src/recurrings/logic.test.ts
import { describe, it, expect } from "vitest";
import { sortRecurrings, dueLabel, ruleChips, cadenceLabel } from "./logic";
import type { RecurringRowDTO } from "@contracts";

const r = (id: string, over: Partial<RecurringRowDTO> = {}): RecurringRowDTO => ({
  id,
  name: id,
  cadence: "monthly",
  dueDay: null,
  dueMonth: null,
  matchType: "contains",
  pattern: id,
  amountMin: 10,
  amountMax: 20,
  categoryId: "c1",
  categoryName: "Subscriptions",
  categoryColor: "var(--data-purple)",
  categoryIcon: "📺",
  predicted: 15,
  state: "due",
  postedThisMonth: 0,
  nextPaymentDate: null,
  timeline: [],
  metricsByYear: [],
  ...over,
});

describe("sortRecurrings", () => {
  it("orders overdue before due before paid (STATE_ORDER, recurrings-view.tsx:16,53)", () => {
    const rows = [r("a", { state: "paid" }), r("b", { state: "overdue" }), r("c", { state: "due" })];
    expect(sortRecurrings(rows).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable: equal-state items keep input order", () => {
    const rows = [
      r("a1", { state: "due" }),
      r("a2", { state: "due" }),
      r("o1", { state: "overdue" }),
      r("a3", { state: "due" }),
      r("o2", { state: "overdue" }),
    ];
    expect(sortRecurrings(rows).map((x) => x.id)).toEqual(["o1", "o2", "a1", "a2", "a3"]);
  });

  it("does not mutate the input array", () => {
    const rows = [r("a", { state: "paid" }), r("b", { state: "overdue" })];
    const copy = [...rows];
    sortRecurrings(rows);
    expect(rows).toEqual(copy);
  });
});

describe("dueLabel (verbatim port of recurrings-view.tsx dueLabel + the row's overdue ternary, lines 19-23 & 99-101)", () => {
  it("overdue state always renders 'Overdue', regardless of cadence/dueDay", () => {
    expect(dueLabel(r("a", { state: "overdue", cadence: "monthly", dueDay: 5 }), "2026-07")).toBe("Overdue");
    expect(dueLabel(r("a", { state: "overdue", cadence: "annually", dueMonth: 3 }), "2026-07")).toBe("Overdue");
  });

  it("monthly with a dueDay renders '<MonthAbbr of the given month> <day>'", () => {
    expect(dueLabel(r("a", { state: "due", cadence: "monthly", dueDay: 5 }), "2026-07")).toBe("Jul 5");
    expect(dueLabel(r("a", { state: "due", cadence: "monthly", dueDay: 31 }), "2026-01")).toBe("Jan 31");
  });

  it("monthly with no dueDay renders 'Anytime'", () => {
    expect(dueLabel(r("a", { state: "due", cadence: "monthly", dueDay: null }), "2026-07")).toBe("Anytime");
  });

  it("annually with a dueMonth renders the abbreviated month name (of dueMonth, not the passed-in month)", () => {
    expect(dueLabel(r("a", { state: "due", cadence: "annually", dueMonth: 12 }), "2026-07")).toBe("Dec");
    expect(dueLabel(r("a", { state: "due", cadence: "annually", dueMonth: 1 }), "2026-07")).toBe("Jan");
  });

  it("annually with no dueMonth renders 'Yearly'", () => {
    expect(dueLabel(r("a", { state: "due", cadence: "annually", dueMonth: null }), "2026-07")).toBe("Yearly");
  });

  it("paid state renders the same due-date label as due (not a distinct 'Paid' string)", () => {
    expect(dueLabel(r("a", { state: "paid", cadence: "monthly", dueDay: 8 }), "2026-06")).toBe("Jun 8");
    expect(dueLabel(r("a", { state: "paid", cadence: "annually", dueMonth: 6 }), "2026-06")).toBe("Jun");
  });
});

describe("ruleChips (port of describeRules, src/lib/portal/recurring-matching.ts:250-270)", () => {
  it("monthly with a due day (matches web test fixture: recurring-matching.test.ts:199-204)", () => {
    expect(
      ruleChips(
        r("a", {
          matchType: "contains",
          pattern: "Movement",
          amountMin: 1791,
          amountMax: 2580,
          cadence: "monthly",
          dueDay: 2,
          dueMonth: null,
        }),
      ),
    ).toEqual(["Named Movement", "from $1,791 to $2,580", "around the 2nd", "every month"]);
  });

  it("annual exact match (matches web test fixture: recurring-matching.test.ts:205-210)", () => {
    expect(
      ruleChips(
        r("a", {
          matchType: "exact",
          pattern: "Copilot",
          amountMin: 95,
          amountMax: 110,
          cadence: "annually",
          dueDay: null,
          dueMonth: 6,
        }),
      ),
    ).toEqual(["Named exactly Copilot", "from $95 to $110", "in June", "every year"]);
  });

  it("exact match type prefixes 'Named exactly', contains prefixes 'Named'", () => {
    expect(ruleChips(r("a", { matchType: "exact", pattern: "Netflix" }))[0]).toBe("Named exactly Netflix");
    expect(ruleChips(r("a", { matchType: "contains", pattern: "Netflix" }))[0]).toBe("Named Netflix");
  });

  it("amount-range chip formats both bounds as whole-dollar currency, even when equal", () => {
    expect(ruleChips(r("a", { amountMin: 10, amountMax: 10 }))[1]).toBe("from $10 to $10");
    expect(ruleChips(r("a", { amountMin: 1000, amountMax: 2500 }))[1]).toBe("from $1,000 to $2,500");
  });

  it("monthly with no due day chips 'anytime in the month'", () => {
    expect(ruleChips(r("a", { cadence: "monthly", dueDay: null }))).toEqual([
      "Named a",
      "from $10 to $20",
      "anytime in the month",
      "every month",
    ]);
  });

  it("annual with no due month omits the month chip entirely (3 chips, not 4)", () => {
    expect(ruleChips(r("a", { cadence: "annually", dueMonth: null }))).toEqual([
      "Named a",
      "from $10 to $20",
      "every year",
    ]);
  });

  it("ordinal suffixes: 1st, 2nd, 3rd, 4th, 11th-13th (teens exception), 21st", () => {
    const day = (d: number) => ruleChips(r("a", { cadence: "monthly", dueDay: d }))[2];
    expect(day(1)).toBe("around the 1st");
    expect(day(2)).toBe("around the 2nd");
    expect(day(3)).toBe("around the 3rd");
    expect(day(4)).toBe("around the 4th");
    expect(day(11)).toBe("around the 11th");
    expect(day(12)).toBe("around the 12th");
    expect(day(13)).toBe("around the 13th");
    expect(day(21)).toBe("around the 21st");
  });
});

describe("cadenceLabel (mirrors the web list row, recurrings-view.tsx:108)", () => {
  it("returns 'Monthly' for monthly cadence", () => {
    expect(cadenceLabel(r("a", { cadence: "monthly" }))).toBe("Monthly");
  });
  it("returns 'Annually' for annual cadence", () => {
    expect(cadenceLabel(r("a", { cadence: "annually" }))).toBe("Annually");
  });
});
