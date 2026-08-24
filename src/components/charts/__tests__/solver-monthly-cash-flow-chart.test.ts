import { describe, it, expect } from "vitest";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";
import {
  applySelectedYearOutline,
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
  // What this proves, and only because EVERY band's value differs in all three
  // years: each dataset walks `rows` in the same order and lands on the same
  // year. A band that reorders, filters, or shifts its own rows moves a number
  // into a year where it does not belong, and the identity breaks there.
  //
  // The variation is the whole assertion. The first version of this test held
  // the four fixed buckets byte-identical across the three rows, which left
  // reversing the Taxes band undetectable — misalignment was visible only in
  // the two bands whose numbers actually changed year to year.
  it("makes the bar total exceed the income line by exactly the draw, every year", () => {
    const rows = [
      drawRow(),
      row({
        year: 2027,
        income: 12_000,
        fixed: {
          taxes: 2_600,
          liabilities: 1_200,
          savings: 900,
          insurance: 200,
          realEstate: 180,
          other: 140,
          total: 5_220,
        },
        leftAfterFixed: 6_780,
        portfolioDraw: 4_000,
        available: 10_780,
      }),
      row({
        year: 2028,
        income: 9_000,
        fixed: {
          taxes: 1_700,
          liabilities: 1_900,
          savings: 1_300,
          insurance: 300,
          realEstate: 140,
          other: 100,
          total: 5_440,
        },
        leftAfterFixed: 3_560,
        portfolioDraw: 1_000,
        available: 4_560,
      }),
    ];
    const data = buildMonthlyCashFlowChartData(rows, "dark");
    const bars = data.datasets.filter((d) => d.type === "bar");
    const income = data.datasets.find((d) => d.type === "line")!;

    // Same order, same years: a reversed or rotated label list points every bar
    // at the wrong plan year, which is the worst misread this chart can produce.
    expect(data.labels).toEqual(["2026", "2027", "2028"]);

    // Liveness for the identity below: with a band held flat across the rows,
    // misalignment inside it is invisible.
    for (const bar of bars) {
      expect(new Set(bar.data).size, `${bar.label} must vary year to year`).toBe(rows.length);
    }

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
  //
  // Four rows, depleted in years 2 and 4, so the expected color array is NOT a
  // palindrome: a reversed array reds here, which a healthy/depleted/healthy
  // trio could not see.
  it("stains only the Available band in the years the portfolio is depleted", () => {
    const rows = [
      row(),
      row({ year: 2027, depleted: true }),
      row({ year: 2028 }),
      row({ year: 2029, depleted: true }),
    ];
    const data = buildMonthlyCashFlowChartData(rows, "dark");

    // Liveness: the assertion below is worthless if the two colors are equal.
    expect(brandData.green).not.toBe(colors.crit);

    const available = data.datasets.find((d) => d.label === "Available")!;
    expect(available.backgroundColor).toEqual([
      brandData.green,
      colors.crit,
      brandData.green,
      colors.crit,
    ]);

    // Each band's own hue, pinned by VALUE. A `typeof === "string"` check alone
    // lets two bands collide on the same color and stay green.
    const bandColor: Record<string, string> = {
      Taxes: brandData.red,
      "Debt payments": brandData.orange,
      Savings: brandData.blue,
      "Other fixed": brandData.grey,
    };
    // Liveness: pinning two bands to the same token would make the pins vacuous.
    expect(new Set(Object.values(bandColor)).size).toBe(4);

    for (const [label, color] of Object.entries(bandColor)) {
      const ds = data.datasets.find((d) => d.label === label)!;
      expect(typeof ds.backgroundColor, `${label} must stay one flat color`).toBe("string");
      expect(ds.backgroundColor, `${label} hue`).toBe(color);
      // The outline is the depletion flag's SECOND carrier, so it has to stay
      // unique to the depleted band. A band that grows its own border spends it.
      expect(ds.borderWidth, `${label} must carry no outline`).toBeUndefined();
    }
  });

  // Hue alone cannot carry this. In light theme the stain (crit #b91c1c) sits
  // only 7.6 ΔE76 from the ordinary Taxes band (#c5392b) — against 25.5 for
  // this chart's tightest INTENTIONAL pair — and hue carries nothing at all for
  // a color-blind reader, in either theme. So a depleted year is also the only
  // segment in the chart that is OUTLINED. Same array mechanism as the fill.
  it("outlines the depleted years' Available segment, and only those", () => {
    const rows = [
      row(),
      row({ year: 2027, depleted: true }),
      row({ year: 2028 }),
      row({ year: 2029, depleted: true }),
    ];
    const available = buildMonthlyCashFlowChartData(rows, "dark").datasets.find(
      (d) => d.label === "Available",
    )!;

    // Liveness: an outline painted in the fill color is not an outline.
    expect(available.borderColor).not.toBe(colors.crit);

    expect(available.borderColor).toBe(colors.ink);
    expect(available.borderWidth).toEqual([0, 2, 0, 2]);
    // All four sides, not the three Chart.js draws by default — the depleted
    // segment reads as boxed off from the stack it sits on.
    expect(available.borderSkipped).toBe(false);
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

    // The outline resolves per theme too — it is a near-black stroke on cream
    // and a near-white one on the dark canvas, so it survives both.
    expect(colorsLight.ink).not.toBe(colors.ink);
    expect(light.datasets.find((d) => d.label === "Available")!.borderColor).toBe(colorsLight.ink);
    expect(dark.datasets.find((d) => d.label === "Available")!.borderColor).toBe(colors.ink);
  });
});

/**
 * The selected-year outline is applied ON TOP of the dataset the builder
 * produced, and the Available band already carries an outline of its own. This
 * is where the two meet.
 */
describe("applySelectedYearOutline", () => {
  /** A color no band uses, so a clobbered border is visible rather than lucky. */
  const SENTINEL = "#00ff00";
  const threeYears = () => [row(), row({ year: 2027, depleted: true }), row({ year: 2028 })];

  it("leaves the data alone when no year is selected", () => {
    const data = buildMonthlyCashFlowChartData(threeYears(), "dark");
    expect(applySelectedYearOutline(data, -1, SENTINEL)).toBe(data);
  });

  // The precedence rule, stated as a test: selecting a year must not un-flag a
  // depleted one. A selection pass that WROTE borderWidth for the whole chart
  // instead of composing with it would zero every unselected year's outline.
  it("keeps a depleted year outlined while a different year is selected", () => {
    const data = buildMonthlyCashFlowChartData(threeYears(), "dark");
    const styled = applySelectedYearOutline(data, 0, SENTINEL);
    const ds = (label: string) => styled.datasets.find((d) => d.label === label)!;

    expect(ds("Available").borderWidth).toEqual([2, 2, 0]);
    expect(ds("Taxes").borderWidth).toEqual([2, 0, 0]);
    // and the depleted band keeps its OWN outline color, not the selection's.
    expect(ds("Available").borderColor).toBe(colors.ink);
    expect(ds("Taxes").borderColor).toBe(SENTINEL);
    // the Income line is not a bar and keeps its own flat stroke.
    expect(ds("Income").borderWidth).toBe(2);
  });

  // Depleted AND selected: the column reads as selected because all five bars
  // are outlined, and the year still reads as depleted because the stain and
  // the tooltip's words are untouched. One stroke, both meanings.
  it("reads as both when the depleted year is also the selected year", () => {
    const data = buildMonthlyCashFlowChartData(threeYears(), "dark");
    const styled = applySelectedYearOutline(data, 1, SENTINEL);
    const available = styled.datasets.find((d) => d.label === "Available")!;

    expect(available.borderWidth).toEqual([0, 2, 0]);
    expect(available.backgroundColor).toEqual([brandData.green, colors.crit, brandData.green]);
    expect(styled.datasets.find((d) => d.label === "Taxes")!.borderWidth).toEqual([0, 2, 0]);
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
