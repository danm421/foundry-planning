import { describe, it, expect } from "vitest";
import { buildMonthlyCashFlowPageData } from "../view-model";
import type { MonthlyCashFlowPageOptions } from "../types";
import { INFLATION, PLAN_START_YEAR, makeMonthlyClientData, makeMonthlyYear } from "./fixtures";

// 2040 is comfortable, 2041 is the first shortfall year (income below fixed
// costs), 2042 is depleted. The shortfall year is the one the screen opens on
// with no year picked, and the sheet has to agree.
function years() {
  return [
    makeMonthlyYear({
      year: 2040,
      totalIncome: 240_000,
      taxes: 60_000, liabilities: 24_000, savings: 12_000, other: 12_000,
      living: 120_000, totalExpenses: 228_000, endingLiquid: 500_000,
    }),
    makeMonthlyYear({
      year: 2041,
      totalIncome: 60_000,
      taxes: 12_000, liabilities: 24_000, savings: 0, other: 36_000,
      living: 120_000, withdrawals: 132_000,
      totalExpenses: 192_000, endingLiquid: 400_000,
    }),
    makeMonthlyYear({
      year: 2042,
      totalIncome: 60_000,
      taxes: 12_000, liabilities: 24_000, other: 36_000,
      living: 120_000, withdrawals: 100_000,
      totalExpenses: 192_000, endingLiquid: -250_000,
    }),
  ];
}

function build(overrides: Partial<MonthlyCashFlowPageOptions> = {}) {
  return buildMonthlyCashFlowPageData({
    years: years(),
    clientData: makeMonthlyClientData(),
    options: { view: "plan", basis: "today", range: "full", year: null, ...overrides },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });
}

describe("buildMonthlyCashFlowPageData — across the plan", () => {
  it("names the scenario and the dollar basis in the subtitle", () => {
    expect(build().subtitle).toBe("Base Case · Today's dollars");
    expect(build({ basis: "nominal" }).subtitle).toBe("Base Case · Future dollars");
  });

  it("prints one row per plan year, as monthly figures", () => {
    const rows = build().planRows;
    expect(rows.map((r) => r.year)).toEqual([2040, 2041, 2042]);
    // Plan-start year: the deflator is 1, so this is a clean division by 12.
    const first = rows[0];
    expect(first.income).toBeCloseTo(20_000, 6);
    expect(first.taxes).toBeCloseTo(5_000, 6);
    expect(first.debt).toBeCloseTo(2_000, 6);
    expect(first.savings).toBeCloseTo(1_000, 6);
    expect(first.other).toBeCloseTo(1_000, 6);
    // income + draw − taxes − debt − savings − other
    expect(first.available).toBeCloseTo(11_000, 6);
  });

  it("deflates later years to plan-start purchasing power on the today basis", () => {
    const today = build().planRows.find((r) => r.year === 2041)!;
    const future = build({ basis: "nominal" }).planRows.find((r) => r.year === 2041)!;
    const gap = 2041 - PLAN_START_YEAR;
    expect(today.income).toBeCloseTo(future.income / (1 + INFLATION) ** gap, 6);
    expect(future.income).toBeCloseTo(5_000, 6);
  });

  it("carries the depletion flag to the row, not to its neighbours", () => {
    const rows = build().planRows;
    expect(rows.map((r) => r.depleted)).toEqual([false, false, true]);
  });

  it("adds a depletion note only when a printed year is actually depleted", () => {
    expect(build().notes.some((n) => /run out|exhaust/i.test(n))).toBe(true);
    const early = build({ range: { startYear: 2040, endYear: 2041 } });
    expect(early.notes.some((n) => /run out|exhaust/i.test(n))).toBe(false);
  });

  it("clips the table to the chosen year range", () => {
    const clipped = build({ range: { startYear: 2041, endYear: 2042 } });
    expect(clipped.planRows.map((r) => r.year)).toEqual([2041, 2042]);
    expect(clipped.chartSpec!.xAxis.domain).toEqual([2041, 2042]);
  });

  it("stacks the chart to income plus the draw, so the gap to the income line IS the draw", () => {
    const spec = build().chartSpec!;
    expect(spec.lines.map((l) => l.label)).toEqual(["Income"]);
    const i = spec.xAxis.domain.indexOf(2041);
    const stacked = spec.stacks.reduce((sum, s) => sum + s.values[i], 0);
    const row = build().planRows.find((r) => r.year === 2041)!;
    expect(stacked).toBeCloseTo(row.income + row.portfolioDraw, 6);
    expect(spec.lines[0].values[i]).toBeCloseTo(row.income, 6);
  });

  it("gives a depleted year its own stack so the stain never needs colour alone", () => {
    const labels = build().chartSpec!.stacks.map((s) => s.label);
    expect(labels).toContain("Overdrawn");
    // Only the depleted year carries any of it.
    const band = build().chartSpec!.stacks.find((s) => s.label === "Overdrawn")!;
    expect(band.values.filter((v) => v !== 0)).toHaveLength(1);
    // ...and no plan without a depleted year gets the band at all.
    const early = build({ range: { startYear: 2040, endYear: 2041 } });
    expect(early.chartSpec!.stacks.map((s) => s.label)).not.toContain("Overdrawn");
  });

  it("never gives the exhausted band a colour already on the chart", () => {
    // Two large flat patches of red read as one, and this renderer cannot
    // outline a series the way the on-screen chart does.
    const stacks = build().chartSpec!.stacks;
    const exhausted = stacks.find((s) => s.label === "Overdrawn")!;
    const others = stacks.filter((s) => s !== exhausted).map((s) => s.color);
    expect(others).not.toContain(exhausted.color);
  });

  it("keeps every legend label short enough for the slot it lands in", () => {
    // The sixth slot has ~37pt before the canvas edge and clips mid-word with
    // no error. ~10 characters is what fits at 7pt Inter.
    const spec = build().chartSpec!;
    const sixth = spec.legend.items[5];
    expect(sixth.label.length).toBeLessThanOrEqual(10);
  });

  it("names every series it draws, within one legend's reach", () => {
    // The renderer places six legend items per row; a series with no legend
    // entry is a band nobody can identify.
    const spec = build().chartSpec!;
    expect(spec.legend.items.map((i) => i.label)).toEqual([
      ...spec.stacks.map((s) => s.label),
      ...spec.lines.map((l) => l.label),
    ]);
  });

  it("leaves the month table empty", () => {
    expect(build().monthRows).toEqual([]);
  });
});

describe("buildMonthlyCashFlowPageData — the summary card", () => {
  it("opens on the first shortfall year when the advisor picked none", () => {
    // 2041 is the first year income falls short of the fixed costs — the same
    // rule the on-screen panel uses, shared rather than restated.
    expect(build().summary!.year).toBe(2041);
  });

  it("honours an explicit year", () => {
    expect(build({ year: 2042 }).summary!.year).toBe(2042);
  });

  it("reconciles available back to income, fixed costs and the draw", () => {
    const s = build({ year: 2040 }).summary!;
    expect(s.leftAfterFixed).toBeCloseTo(s.income - s.fixedTotal, 6);
    expect(s.available).toBeCloseTo(s.leftAfterFixed + s.portfolioDraw, 6);
  });

  it("keeps whatever the named parts cannot account for on its own line", () => {
    const s = build({ year: 2040 }).summary!;
    expect(s.unexplained).toBeCloseTo(
      s.available - s.living - s.surplusSpent - s.surplusUnspent,
      6,
    );
  });
});

describe("buildMonthlyCashFlowPageData — month by month", () => {
  const monthly = () => build({ view: "months", year: 2041 });

  it("prints twelve months and no plan rows", () => {
    const data = monthly();
    expect(data.monthRows).toHaveLength(12);
    expect(data.monthRows[0].label).toBe("January");
    expect(data.monthRows[11].label).toBe("December");
    expect(data.planRows).toEqual([]);
  });

  it("captions the same year the months belong to", () => {
    expect(monthly().summary!.year).toBe(2041);
  });

  it("labels the x-axis by month, not by year", () => {
    const spec = monthly().chartSpec!;
    expect(spec.xAxis.domain).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(spec.xAxis.ticks).toHaveLength(12);
    expect(spec.xAxis.labelFormat(1)).toBe("Jan");
    expect(spec.xAxis.labelFormat(12)).toBe("Dec");
  });

  it("always warns that cash on hand is a running total, not a balance", () => {
    expect(monthly().notes.some((n) => /not an account balance/i.test(n))).toBe(true);
  });

  it("explains the missing surplus column only in the years it is true of", () => {
    expect(monthly().notes.some((n) => /surplus/i.test(n))).toBe(false);
    const withSurplus = buildMonthlyCashFlowPageData({
      years: years().map((y) =>
        y.year === 2041
          ? ({ ...y, expenses: { ...y.expenses, discretionary: 24_000 } } as typeof y)
          : y,
      ),
      clientData: makeMonthlyClientData(),
      options: { view: "months", basis: "today", range: "full", year: 2041 },
      scenarioLabel: "Base Case",
      clientName: "Cooper",
      spouseName: "Susan",
    });
    expect(withSurplus.notes.some((n) => /surplus/i.test(n))).toBe(true);
  });
});
