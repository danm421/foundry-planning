import { describe, it, expect } from "vitest";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { computeNeedOverTime, hasSpouse } from "../need-over-time";
import { marriedBase } from "./test-helpers";

describe("computeNeedOverTime", () => {
  it("returns a client and spouse need value for each plan year", () => {
    const data = marriedBase();
    const rows = computeNeedOverTime(data, {
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
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
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
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
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    for (const row of rows) {
      expect(row.spouseNeed).toBeNull();
      expect(row.spouseStatus).toBeNull();
    }
  });

  it("does not run the spouse solve when filingStatus is married but spouseDob is absent", () => {
    // filingStatus and spouseDob disagree: the engine's whatIf throws on a
    // spouse death when spouseDob is missing, so the spouse solve must be
    // gated on spouseDob presence, not filingStatus alone. Accounts are
    // re-titled to the client so the client-death solve itself is valid —
    // this isolates the spouse-solve gating from any spouse-owned assets.
    const data = marriedBase();
    data.client.filingStatus = "married_joint";
    delete data.client.spouseDob;
    data.accounts = data.accounts.map((acct) => ({
      ...acct,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    }));

    const opts = {
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    };
    expect(() => computeNeedOverTime(data, opts)).not.toThrow();
    const rows = computeNeedOverTime(data, opts);
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
        proceedsGrowthRate: 0.05,
        leaveToHeirsAmount: 500_000,
        livingExpenseAtDeath: null,
        payoffLiabilityIds: [],
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

describe("hasSpouse", () => {
  it("is true for a married plan with a spouseDob", () => {
    expect(hasSpouse(marriedBase())).toBe(true);
  });

  it("is false for a married plan with no spouseDob (gates /solve + /solve-mc)", () => {
    const data = marriedBase();
    delete data.client.spouseDob;
    expect(hasSpouse(data)).toBe(false);
  });

  it("is false for a single filer regardless of spouseDob", () => {
    const data = marriedBase();
    data.client.filingStatus = "single";
    expect(hasSpouse(data)).toBe(false);
  });
});
