import { describe, it, expect } from "vitest";
import { computeNeedOverTime } from "../need-over-time";
import { marriedBase } from "./test-helpers";

describe("computeNeedOverTime", () => {
  it("returns a client and spouse need value for each plan year", () => {
    const data = marriedBase();
    const rows = computeNeedOverTime(data, {
      growthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    expect(rows.length).toBe(
      data.planSettings.planEndYear - data.planSettings.planStartYear + 1,
    );
    expect(rows[0]).toHaveProperty("year");
    expect(rows[0]).toHaveProperty("clientNeed");
    expect(rows[0]).toHaveProperty("spouseNeed");
  });

  it("uses each plan year as the deathYear and reports the year on each row", () => {
    const data = marriedBase();
    const rows = computeNeedOverTime(data, {
      growthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    expect(rows[0].year).toBe(data.planSettings.planStartYear);
    expect(rows[rows.length - 1].year).toBe(data.planSettings.planEndYear);
    for (const row of rows) {
      expect(typeof row.clientNeed).toBe("number");
      expect(row.clientStatus).toMatch(/^(solved|exceeds-cap)$/);
      // Married fixture → spouse values are present.
      expect(typeof row.spouseNeed).toBe("number");
      expect(row.spouseStatus).toMatch(/^(solved|exceeds-cap)$/);
    }
  });

  it("returns null spouse values when the client is not married", () => {
    const data = marriedBase();
    data.client.filingStatus = "single";
    const rows = computeNeedOverTime(data, {
      growthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    for (const row of rows) {
      expect(row.spouseNeed).toBeNull();
      expect(row.spouseStatus).toBeNull();
    }
  });

  it("invokes onProgress once per year with a cumulative done count", () => {
    const data = marriedBase();
    const calls: Array<{ done: number; total: number }> = [];
    const rows = computeNeedOverTime(
      data,
      {
        growthRate: 0.05,
        leaveToHeirsAmount: 500_000,
        finalExpenses: 25_000,
        livingExpenseAtDeath: null,
        payOffDebtsAtDeath: false,
      },
      (done, total) => calls.push({ done, total }),
    );
    expect(calls.length).toBe(rows.length);
    expect(calls[0]).toEqual({ done: 1, total: rows.length });
    expect(calls[calls.length - 1]).toEqual({
      done: rows.length,
      total: rows.length,
    });
  });
});
