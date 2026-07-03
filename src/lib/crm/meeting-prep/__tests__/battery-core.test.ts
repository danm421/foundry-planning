import { describe, expect, it } from "vitest";
import {
  resolveWindowStart,
  deriveLastMeetingDate,
  filterNotesInWindow,
  splitTasks,
  portfolioFromCrmAccounts,
  portfolioFromPlanningAccounts,
} from "../battery-core";

const NOW = new Date("2026-07-02T12:00:00.000Z");

describe("resolveWindowStart", () => {
  it("prefers the explicit override", () => {
    expect(resolveWindowStart(new Date("2026-05-01"), "2026-01-15", NOW)).toBe("2026-01-15");
  });
  it("uses the last meeting date when no override", () => {
    expect(resolveWindowStart(new Date("2026-05-01T09:00:00Z"), null, NOW)).toBe("2026-05-01");
  });
  it("falls back to 90 days before now", () => {
    expect(resolveWindowStart(null, null, NOW)).toBe("2026-04-03");
  });
});

describe("deriveLastMeetingDate", () => {
  it("returns the latest meeting/call and ignores other kinds", () => {
    const d = deriveLastMeetingDate([
      { kind: "note", occurredAt: new Date("2026-06-30") },
      { kind: "call", occurredAt: new Date("2026-05-10") },
      { kind: "meeting", occurredAt: new Date("2026-04-01") },
    ]);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-10");
  });
  it("returns null when there are no meetings or calls", () => {
    expect(deriveLastMeetingDate([{ kind: "note", occurredAt: NOW }])).toBeNull();
  });
});

describe("splitTasks", () => {
  const rows = [
    { id: "a", title: "Open one", status: "open" as const, priority: "high" as const, dueDate: "2026-06-01", completedAt: null },
    { id: "b", title: "Done in window", status: "done" as const, priority: "med" as const, dueDate: null, completedAt: new Date("2026-06-15") },
    { id: "c", title: "Done before window", status: "done" as const, priority: "low" as const, dueDate: null, completedAt: new Date("2026-01-01") },
    { id: "d", title: "Blocked", status: "blocked" as const, priority: "med" as const, dueDate: null, completedAt: null },
  ];
  it("splits outstanding vs completed-in-window", () => {
    const { outstanding, completedInWindow } = splitTasks(rows, "2026-05-01");
    expect(outstanding.map((t) => t.id)).toEqual(["a", "d"]);
    expect(completedInWindow.map((t) => t.id)).toEqual(["b"]);
  });
  it("serializes completedAt to YYYY-MM-DD", () => {
    const { completedInWindow } = splitTasks(rows, "2026-05-01");
    expect(completedInWindow[0].completedAt).toBe("2026-06-15");
  });
});

describe("filterNotesInWindow", () => {
  const notes = [
    { id: "in", occurredAt: "2026-06-15T12:00:00.000Z" },
    { id: "before", occurredAt: "2026-04-30T23:59:59.999Z" },
    { id: "boundary", occurredAt: "2026-05-01T00:00:00.000Z" },
  ];
  it("keeps notes on or after windowStart and drops earlier ones", () => {
    const kept = filterNotesInWindow(notes, "2026-05-01");
    expect(kept.map((n) => n.id)).toEqual(["in", "boundary"]);
  });
  it("keeps a note exactly at windowStart midnight UTC", () => {
    expect(
      filterNotesInWindow([{ occurredAt: "2026-05-01T00:00:00.000Z" }], "2026-05-01"),
    ).toHaveLength(1);
  });
  it("drops a note just before windowStart", () => {
    expect(
      filterNotesInWindow([{ occurredAt: "2026-04-30T23:59:59.999Z" }], "2026-05-01"),
    ).toHaveLength(0);
  });
});

describe("portfolio builders", () => {
  it("sums CRM balances, tolerating nulls, and labels the source", () => {
    const p = portfolioFromCrmAccounts([
      { accountType: "IRA", custodian: "Schwab", accountNumberLast4: "1234", balance: "250000.00", balanceAsOf: "2026-06-01" },
      { accountType: null, custodian: null, accountNumberLast4: null, balance: null, balanceAsOf: null },
    ]);
    expect(p.source).toBe("crm");
    expect(p.total).toBe(250_000);
    expect(p.accounts).toHaveLength(2);
    expect(p.accounts[0]).toEqual({
      name: "Schwab IRA (…1234)",
      category: "IRA",
      custodian: "Schwab",
      balance: 250_000,
      balanceAsOf: "2026-06-01",
    });
  });
  it("maps planning accounts with category labels", () => {
    const p = portfolioFromPlanningAccounts([
      { name: "Brokerage", category: "taxable", value: "500000" },
      { name: "401(k)", category: "retirement", value: "800000" },
    ]);
    expect(p.source).toBe("planning");
    expect(p.total).toBe(1_300_000);
    expect(p.accounts[0].category).toBe("Taxable");
    expect(p.accounts[1].category).toBe("Retirement");
  });
});
