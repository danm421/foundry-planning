import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData, basePlanSettings } from "@/engine/__tests__/fixtures";
import { buildMonthlyCashFlowRows } from "../monthly-cash-flow";

const MONTHS_PER_YEAR = 12;
const LIVING_ANNUAL = 60_000;

describe("today's dollars", () => {
  // The expense window is `basePlanSettings`' own horizon (2026–2055) on
  // purpose. End it short and `split.living` falls to zero in the tail years,
  // which reds the flat line for a reason that has nothing to do with the
  // deflator.
  //
  // No default-checking account here, and that is deliberate: without one the
  // engine skips the whole surplus phase, so `expenses.living` is the bare
  // schedule with no absorb top-up — exactly the clean series a deflator test
  // wants.
  const clientData = buildClientData({
    planSettings: { ...basePlanSettings, inflationRate: 0.03 },
    expenses: [
      {
        id: "exp-living",
        type: "living",
        name: "Living Expenses",
        annualAmount: LIVING_ANNUAL,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0.03,
      },
    ],
  });
  const years = runProjection(clientData);

  // A living expense growing at EXACTLY the inflation rate must deflate to a
  // flat line. That pins the deflator's RATE: inverting the ratio (multiply
  // instead of divide) slopes the series and reds the loop below — measured at
  // 5,304.50 in the second row against 5,000.00 in the first.
  //
  // What a flat line does NOT pin, also measured rather than assumed: the BASE
  // YEAR. Changing the exponent to `(year - planStartYear + 1)` scales EVERY
  // row by the same 1/1.03, so the series stays perfectly flat — just 2.9% low
  // — and a shape-only assertion sails through. The level anchor is what
  // catches that one, so the two assertions are not redundant.
  it("holds an inflation-matched expense flat across thirty years", () => {
    const rows = buildMonthlyCashFlowRows(years, clientData, "today");
    // Makes "thirty years" a checked claim rather than a decorative title.
    expect(rows).toHaveLength(30);
    const first = rows[0].split.living;
    // Level anchor: deflator(planStartYear) must be exactly 1, so row one is
    // the undeflated 60k schedule. Doubles as the fixture-liveness guard.
    expect(first).toBeCloseTo(LIVING_ANNUAL / MONTHS_PER_YEAR, 4);
    for (const r of rows) {
      expect(r.split.living).toBeCloseTo(first, 4);
    }
  });

  it("leaves the same series sloping upward in nominal dollars", () => {
    const rows = buildMonthlyCashFlowRows(years, clientData, "nominal");
    expect(rows[rows.length - 1].split.living).toBeGreaterThan(rows[0].split.living * 2);
  });

  it("does not touch the plan's first year", () => {
    const today = buildMonthlyCashFlowRows(years, clientData, "today");
    const nominal = buildMonthlyCashFlowRows(years, clientData, "nominal");
    expect(today[0].available).toBeCloseTo(nominal[0].available, 6);
  });

  it("defaults to today's dollars", () => {
    const explicit = buildMonthlyCashFlowRows(years, clientData, "today");
    const implicit = buildMonthlyCashFlowRows(years, clientData);
    expect(implicit[10].available).toBeCloseTo(explicit[10].available, 6);
  });
});
