import { describe, it, expect } from "vitest";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { computeNeedOverTime, hasSpouse } from "../need-over-time";
import { solveLifeInsuranceNeed, type LifeInsuranceAssumptions } from "../solve-need";
import { computeEstateTaxAddend } from "../estate-tax-addend";
import { marriedBase, highNetWorthBase, hnwAssumptions } from "./test-helpers";

describe("computeNeedOverTime", () => {
  it("returns a client and spouse need value for each plan year", async () => {
    const data = marriedBase();
    const rows = await computeNeedOverTime(data, {
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    }, false);
    expect(rows.length).toBe(
      data.planSettings.planEndYear - data.planSettings.planStartYear + 1,
    );
    expect(rows[0]).toHaveProperty("year");
    expect(rows[0]).toHaveProperty("clientNeed");
    expect(rows[0]).toHaveProperty("spouseNeed");
  });

  it("uses each plan year as the deathYear and reports the year on each row", async () => {
    const data = marriedBase();
    const rows = await computeNeedOverTime(data, {
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    }, false);
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

  it("returns null spouse values when the client is not married", async () => {
    const data = marriedBase();
    data.client.filingStatus = "single";
    const rows = await computeNeedOverTime(data, {
      proceedsGrowthRate: 0.05,
      leaveToHeirsAmount: 500_000,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    }, false);
    for (const row of rows) {
      expect(row.spouseNeed).toBeNull();
      expect(row.spouseStatus).toBeNull();
    }
  });

  it("does not run the spouse solve when filingStatus is married but spouseDob is absent", async () => {
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
    await expect(computeNeedOverTime(data, opts, false)).resolves.toBeDefined();
    const rows = await computeNeedOverTime(data, opts, false);
    for (const row of rows) {
      expect(row.spouseNeed).toBeNull();
      expect(row.spouseStatus).toBeNull();
    }
  });

  it("invokes onProgress once per year with a cumulative done count", async () => {
    const data = marriedBase();
    const calls: Array<{ done: number; total: number }> = [];
    const rows = await computeNeedOverTime(
      data,
      {
        proceedsGrowthRate: 0.05,
        leaveToHeirsAmount: 500_000,
        livingExpenseAtDeath: null,
        payoffLiabilityIds: [],
      },
      false,
      (done, total) => calls.push({ done, total }),
    );
    expect(calls.length).toBe(rows.length);
    expect(calls[0]).toEqual({ done: 1, total: rows.length });
    expect(calls[calls.length - 1]).toEqual({
      done: rows.length,
      total: rows.length,
    });
  });

  it("yields to the event loop between years so a streaming caller can flush", async () => {
    const data = marriedBase();
    // A setImmediate chain only advances when the solve loop lets the event
    // loop breathe — exactly what the SSE route needs for enqueued progress
    // chunks to reach the socket mid-solve instead of all at once at the end.
    let turns = 0;
    let stop = false;
    const tick = () => {
      turns++;
      if (!stop) setImmediate(tick);
    };
    setImmediate(tick);

    const turnsAtProgress: number[] = [];
    await computeNeedOverTime(
      data,
      {
        proceedsGrowthRate: 0.05,
        leaveToHeirsAmount: 500_000,
        livingExpenseAtDeath: null,
        payoffLiabilityIds: [],
      },
      false,
      () => turnsAtProgress.push(turns),
    );
    stop = true;

    expect(turnsAtProgress.length).toBeGreaterThan(1);
    // Every year's progress callback must observe at least one event-loop turn
    // since the previous one.
    for (let i = 1; i < turnsAtProgress.length; i++) {
      expect(turnsAtProgress[i]).toBeGreaterThan(turnsAtProgress[i - 1]);
    }
  });

  describe("coverEstateTaxes (#9)", () => {
    // Death-year 2030 addend on the HNW fixture (probed): client ≈ $12.6M,
    // spouse ≈ $8.2M. leaveToHeirs is set to $90M so the survivor's ending
    // portfolio (client ending0 ≈ $66.9M, spouse ≈ $54.7M) falls SHORT of the
    // target — the solve lands a positive, sub-cap face value for both cases,
    // so folding in the addend genuinely moves the need (guards a no-op wire).
    const LEAVE_TO_HEIRS = 90_000_000;
    const overTime: Omit<LifeInsuranceAssumptions, "deathYear"> = {
      proceedsGrowthRate: hnwAssumptions.proceedsGrowthRate,
      proceedsRealization: hnwAssumptions.proceedsRealization,
      leaveToHeirsAmount: LEAVE_TO_HEIRS,
      livingExpenseAtDeath: hnwAssumptions.livingExpenseAtDeath,
      payoffLiabilityIds: hnwAssumptions.payoffLiabilityIds,
    };

    it("leaves the curve unchanged when the toggle is off", async () => {
      const data = highNetWorthBase();
      const rows = await computeNeedOverTime(data, overTime, false);
      const deathYear = hnwAssumptions.deathYear;
      const row = rows.find((r) => r.year === deathYear)!;
      // Parity with the raw (no-addend) single-point solve.
      const expected = solveLifeInsuranceNeed(data, "client", {
        ...overTime,
        deathYear,
      });
      expect(row.clientNeed).toBe(expected.faceValue);
    });

    it("folds the per-year estate-tax addend into the need when the toggle is on", async () => {
      const data = highNetWorthBase();
      const deathYear = hnwAssumptions.deathYear;

      const withTax = await computeNeedOverTime(data, overTime, true);
      const rowOn = withTax.find((r) => r.year === deathYear)!;

      // The addend is genuinely positive at this death year for both decedents,
      // so the toggle-on need must exceed the raw no-addend need.
      const rawClient = solveLifeInsuranceNeed(data, "client", { ...overTime, deathYear });
      const rawSpouse = solveLifeInsuranceNeed(data, "spouse", { ...overTime, deathYear });
      expect(rowOn.clientNeed).toBeGreaterThan(rawClient.faceValue);
      expect(rowOn.spouseNeed!).toBeGreaterThan(rawSpouse.faceValue);

      // Parity: the curve's death-year row equals the single-point straight-line
      // solve at that death year — target augmented by that year's addend
      // (mirrors solveCase in /life-insurance/solve).
      const yearAssumptions: LifeInsuranceAssumptions = { ...overTime, deathYear };
      const clientAddend = computeEstateTaxAddend(data, "client", yearAssumptions);
      const spouseAddend = computeEstateTaxAddend(data, "spouse", yearAssumptions);
      const expectedClient = solveLifeInsuranceNeed(data, "client", {
        ...yearAssumptions,
        leaveToHeirsAmount: LEAVE_TO_HEIRS + clientAddend,
      });
      const expectedSpouse = solveLifeInsuranceNeed(data, "spouse", {
        ...yearAssumptions,
        leaveToHeirsAmount: LEAVE_TO_HEIRS + spouseAddend,
      });
      expect(rowOn.clientNeed).toBe(expectedClient.faceValue);
      expect(rowOn.spouseNeed).toBe(expectedSpouse.faceValue);
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
