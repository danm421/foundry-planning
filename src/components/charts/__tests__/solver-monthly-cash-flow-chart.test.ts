import { describe, it, expect } from "vitest";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";
import {
  buildMonthlyCashFlowChartData,
  monthlyCashFlowTooltipLabel,
} from "../solver-monthly-cash-flow-chart";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";

/**
 * Every field a bar reads carries a DISTINCT value, so a swap between two bars
 * changes both numbers. Task 1 shipped a bug of exactly this shape: the fixed
 * costs were pinned only through their sum, so swapping `liabilities` and
 * `insurance` left every assertion green while the mortgage rendered on the
 * insurance row.
 *
 * The three folded buckets (250 / 130 / 120) are distinct from each other too,
 * so dropping any ONE of them moves the "Other fixed" bar.
 */
function row(over: Partial<MonthlyCashFlowRow> = {}): MonthlyCashFlowRow {
  return {
    year: 2026,
    ageLabel: "Age 56",
    income: 10_000,
    fixed: {
      taxes: 2_000,
      liabilities: 1_500,
      savings: 1_000,
      insurance: 250,
      realEstate: 130,
      other: 120,
      total: 5_000,
    },
    leftAfterFixed: 5_000,
    portfolioDraw: 0,
    available: 5_000,
    split: { living: 5_000, surplusSpent: 0, surplusUnspent: 0, unexplained: 0 },
    depleted: false,
    ...over,
  };
}

/** The draw year: bars stack to 13,000 against a 10,000 income line. */
const drawRow = () => row({ portfolioDraw: 3_000, available: 8_000, leftAfterFixed: 5_000 });

describe("buildMonthlyCashFlowChartData", () => {
  it("stacks the four fixed buckets plus available, and plots income as a line", () => {
    const data = buildMonthlyCashFlowChartData([row()], "dark");
    const bars = data.datasets.filter((d) => d.type === "bar");
    const lines = data.datasets.filter((d) => d.type === "line");
    expect(bars.map((d) => d.label)).toEqual([
      "Taxes",
      "Debt payments",
      "Savings",
      "Other fixed",
      "Available",
    ]);
    expect(lines.map((d) => d.label)).toEqual(["Income"]);
    expect(bars.every((d) => d.stack === "monthly")).toBe(true);
  });

  // Catches a SWAP between two bars, which neither the label list above nor the
  // bar-total assertion below can see: both stay green while a bar renders
  // somebody else's number.
  it("feeds each bar its own field, and folds insurance + real estate + other into one", () => {
    const data = buildMonthlyCashFlowChartData([drawRow()], "dark");
    const value = (label: string) => data.datasets.find((d) => d.label === label)?.data[0];

    expect(value("Taxes")).toBeCloseTo(2_000, 6);
    expect(value("Debt payments")).toBeCloseTo(1_500, 6);
    expect(value("Savings")).toBeCloseTo(1_000, 6);
    expect(value("Other fixed")).toBeCloseTo(500, 6); // 250 + 130 + 120
    expect(value("Available")).toBeCloseTo(8_000, 6);
    expect(value("Income")).toBeCloseTo(10_000, 6);
  });

  // The chart's whole reason for existing: the visible gap between the income
  // line and the top of the stack IS the portfolio draw.
  //
  // Asserted across THREE years with different draws, which is what makes it
  // load-bearing. On a single row it is algebraically implied by the per-bar
  // pins above and can never red on its own (measured — see the task report).
  // Over several years it pins that every dataset walks `rows` in the same
  // order, so a band that reorders or filters its own rows breaks the identity
  // in the years the single-row pins cannot see.
  it("makes the bar total exceed the income line by exactly the draw, every year", () => {
    const rows = [
      drawRow(),
      row({ year: 2027, income: 12_000, leftAfterFixed: 7_000, portfolioDraw: 4_000, available: 11_000 }),
      row({ year: 2028, income: 9_000, leftAfterFixed: 4_000, portfolioDraw: 1_000, available: 5_000 }),
    ];
    const data = buildMonthlyCashFlowChartData(rows, "dark");
    const bars = data.datasets.filter((d) => d.type === "bar");
    const income = data.datasets.find((d) => d.type === "line")!;

    rows.forEach((r, i) => {
      const barTotal = bars.reduce((s, d) => s + d.data[i], 0);
      expect(barTotal - income.data[i], `year ${r.year}`).toBeCloseTo(r.portfolioDraw, 6);
    });
  });

  it("labels the x axis with plan years", () => {
    const data = buildMonthlyCashFlowChartData([row({ year: 2031 })], "dark");
    expect(data.labels).toEqual(["2031"]);
  });

  // A depleted year's Available money does not exist. Stain that band, and ONLY
  // that band — restaining the whole stack would say the taxes weren't paid
  // either, which is not what the engine did.
  it("stains only the Available band in the years the portfolio is depleted", () => {
    const rows = [row(), row({ year: 2027, depleted: true }), row({ year: 2028 })];
    const data = buildMonthlyCashFlowChartData(rows, "dark");

    // Liveness: the assertion below is worthless if the two colors are equal.
    expect(brandData.green).not.toBe(colors.crit);

    const available = data.datasets.find((d) => d.label === "Available")!;
    expect(available.backgroundColor).toEqual([brandData.green, colors.crit, brandData.green]);

    for (const label of ["Taxes", "Debt payments", "Savings", "Other fixed"]) {
      const ds = data.datasets.find((d) => d.label === label)!;
      expect(typeof ds.backgroundColor, `${label} must stay one flat color`).toBe("string");
    }
  });

  it("resolves the depletion stain against the requested theme", () => {
    const rows = [row({ depleted: true })];
    const light = buildMonthlyCashFlowChartData(rows, "light");
    const dark = buildMonthlyCashFlowChartData(rows, "dark");

    expect(colorsLight.crit).not.toBe(colors.crit);
    expect(light.datasets.find((d) => d.label === "Available")!.backgroundColor).toEqual([
      colorsLight.crit,
    ]);
    expect(dark.datasets.find((d) => d.label === "Available")!.backgroundColor).toEqual([
      colors.crit,
    ]);
    expect(light.datasets.find((d) => d.label === "Taxes")!.backgroundColor).toBe(
      brandDataLight.red,
    );
  });
});

describe("monthlyCashFlowTooltipLabel", () => {
  // Color alone must not carry the meaning — the tooltip says it in words.
  it("says in words that a depleted year's Available money is not there", () => {
    expect(monthlyCashFlowTooltipLabel("Available", 8_000, false)).toBe("Available: $8,000/mo");
    expect(monthlyCashFlowTooltipLabel("Available", 8_000, true)).toBe(
      "Available: $8,000/mo — the portfolio has run out; this money is not there",
    );
  });

  it("leaves the other rows of a depleted year alone", () => {
    expect(monthlyCashFlowTooltipLabel("Taxes", 2_000, true)).toBe("Taxes: $2,000/mo");
    expect(monthlyCashFlowTooltipLabel("Income", 10_000, true)).toBe("Income: $10,000/mo");
  });
});
