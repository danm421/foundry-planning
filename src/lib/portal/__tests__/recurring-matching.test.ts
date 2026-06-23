import { it, expect } from "vitest";
import {
  matchesRecurring,
  resolveRecurringClaim,
  predictRecurringAmount,
  isRecurringDueInMonth,
  recurringPeriodState,
  type RecurringLike,
} from "@/lib/portal/recurring-matching";

const base: RecurringLike = {
  id: "r1",
  matchType: "contains",
  pattern: "costco",
  amountMin: 100,
  amountMax: 400,
  cadence: "monthly",
  dueDay: 15,
  dueMonth: null,
  categoryId: "l-groceries",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

it("matches on pattern + amount-in-range + monthly period", () => {
  expect(
    matchesRecurring(base, { merchantName: "COSTCO WHSE", name: "x", amount: 250, date: "2026-06-10" }),
  ).toBe(true);
});

it("rejects when amount is below the range", () => {
  expect(
    matchesRecurring(base, { merchantName: "Costco", name: "x", amount: 50, date: "2026-06-10" }),
  ).toBe(false);
});

it("rejects when amount is above the range", () => {
  expect(
    matchesRecurring(base, { merchantName: "Costco", name: "x", amount: 500, date: "2026-06-10" }),
  ).toBe(false);
});

it("rejects when the pattern does not match either field", () => {
  expect(
    matchesRecurring(base, { merchantName: "Target", name: "shopping", amount: 250, date: "2026-06-10" }),
  ).toBe(false);
});

it("annual recurring matches in any month (period is the year; reservation is gated elsewhere)", () => {
  const annual: RecurringLike = { ...base, cadence: "annually", dueDay: null, dueMonth: 6, amountMin: 50, amountMax: 150 };
  expect(
    matchesRecurring(annual, { merchantName: "Costco", name: "x", amount: 100, date: "2026-03-10" }),
  ).toBe(true);
});

it("resolveRecurringClaim returns the earliest-created matching recurring", () => {
  const older: RecurringLike = { ...base, id: "old", createdAt: new Date("2025-01-01T00:00:00Z") };
  const newer: RecurringLike = { ...base, id: "new", createdAt: new Date("2026-05-01T00:00:00Z") };
  const hit = resolveRecurringClaim(
    [newer, older],
    { merchantName: "Costco", name: "x", amount: 250, date: "2026-06-10" },
  );
  expect(hit).toEqual({ recurringId: "old", categoryId: "l-groceries" });
});

it("resolveRecurringClaim returns null when nothing matches", () => {
  expect(
    resolveRecurringClaim([base], { merchantName: "Target", name: "x", amount: 9, date: "2026-06-10" }),
  ).toBe(null);
});

it("predictRecurringAmount averages matched history, rounded to cents", () => {
  expect(predictRecurringAmount([200, 250, 300], { amountMin: 100, amountMax: 400 })).toBe(250);
  expect(predictRecurringAmount([100, 101], { amountMin: 0, amountMax: 500 })).toBe(100.5);
});

it("predictRecurringAmount falls back to range midpoint with no history", () => {
  expect(predictRecurringAmount([], { amountMin: 100, amountMax: 400 })).toBe(250);
});

it("isRecurringDueInMonth: monthly is due every month", () => {
  expect(isRecurringDueInMonth(base, "2026-06")).toBe(true);
  expect(isRecurringDueInMonth(base, "2026-12")).toBe(true);
});

it("isRecurringDueInMonth: annual is due only in its due month", () => {
  const annual: RecurringLike = { ...base, cadence: "annually", dueDay: null, dueMonth: 6 };
  expect(isRecurringDueInMonth(annual, "2026-06")).toBe(true);
  expect(isRecurringDueInMonth(annual, "2026-07")).toBe(false);
});

it("recurringPeriodState: paid when matched this period", () => {
  expect(recurringPeriodState({ dueDay: 15, today: "2026-06-20", hasMatchThisPeriod: true })).toBe("paid");
});

it("recurringPeriodState: due before the due day, overdue after", () => {
  expect(recurringPeriodState({ dueDay: 15, today: "2026-06-10", hasMatchThisPeriod: false })).toBe("due");
  expect(recurringPeriodState({ dueDay: 15, today: "2026-06-20", hasMatchThisPeriod: false })).toBe("overdue");
});

it("recurringPeriodState: 'anytime' (null dueDay) never goes overdue mid-month", () => {
  expect(recurringPeriodState({ dueDay: null, today: "2026-06-28", hasMatchThisPeriod: false })).toBe("due");
});

it("matchesRecurring: amount exactly at amountMin (100) is inside the range", () => {
  expect(
    matchesRecurring(base, { merchantName: "Costco", name: "x", amount: 100, date: "2026-06-10" }),
  ).toBe(true);
});

it("matchesRecurring: amount exactly at amountMax (400) is inside the range", () => {
  expect(
    matchesRecurring(base, { merchantName: "Costco", name: "x", amount: 400, date: "2026-06-10" }),
  ).toBe(true);
});

it("matchesRecurring: exact matchType matches when field equals pattern exactly (case-insensitive)", () => {
  const exact: RecurringLike = { ...base, matchType: "exact", pattern: "costco" };
  expect(
    matchesRecurring(exact, { merchantName: "Costco", name: "x", amount: 250, date: "2026-06-10" }),
  ).toBe(true);
});

it("matchesRecurring: exact matchType rejects a superstring", () => {
  const exact: RecurringLike = { ...base, matchType: "exact", pattern: "costco" };
  expect(
    matchesRecurring(exact, { merchantName: "COSTCO WHSE", name: "x", amount: 250, date: "2026-06-10" }),
  ).toBe(false);
});

it("recurringPeriodState: due day itself is 'due' (not overdue)", () => {
  expect(recurringPeriodState({ dueDay: 15, today: "2026-06-15", hasMatchThisPeriod: false })).toBe("due");
});
