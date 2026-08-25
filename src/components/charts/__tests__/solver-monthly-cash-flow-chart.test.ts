import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";
import {
  applySelectedYearOutline,
  buildMonthAllocationChartData,
  buildMonthlyCashFlowChartData,
  clickedYear,
  depletedAt,
  monthlyCashFlowTooltipLabel,
  selectedYearIndex,
} from "../solver-monthly-cash-flow-chart";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";
import type { MonthRow } from "@/lib/solver/monthly-allocation";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
    expect(monthlyCashFlowTooltipLabel("Available", 8_000, false, false)).toBe("Available: $8,000/mo");
    expect(monthlyCashFlowTooltipLabel("Available", 8_000, true, false)).toBe(
      "Available: $8,000/mo — the portfolio has run out; this money is not there",
    );
  });

  // Across the plan every figure is a year's total spread over twelve, so "/mo"
  // is what it is. In month view the figure is what lands IN that month — a
  // November property-tax bill is $12,000 in November, not $12,000 a month.
  it("drops the per-month suffix in month view", () => {
    expect(monthlyCashFlowTooltipLabel("Other", 12_000, false, true)).toBe("Other: $12,000");
    expect(monthlyCashFlowTooltipLabel("Other", 12_000, false, false)).toBe("Other: $12,000/mo");
  });

  it("leaves the other rows of a depleted year alone", () => {
    expect(monthlyCashFlowTooltipLabel("Taxes", 2_000, true, false)).toBe("Taxes: $2,000/mo");
    expect(monthlyCashFlowTooltipLabel("Income", 10_000, true, false)).toBe("Income: $10,000/mo");
  });
});

/**
 * Every field carries a DISTINCT value that also VARIES month to month. Distinct
 * so a swap between two bands changes both numbers; varying so the liveness loop
 * in the identity test below has something to see — a band held flat hides
 * misalignment inside it.
 *
 * `surplusSpent` is zero here, so `net` is exactly the residual the chart draws.
 */
function monthRow(i: number, over: Partial<MonthRow> = {}): MonthRow {
  const income = 8_000 + 100 * i;
  const portfolioDraw = 1_000 + 10 * i;
  const taxes = 1_500 + 3 * i;
  const debt = 900 + 7 * i;
  const savings = 500 + 11 * i;
  const other = 400 + 13 * i;
  const living = 5_000 + 17 * i;
  return {
    month: i + 1,
    label: MONTH_NAMES[i],
    income,
    portfolioDraw,
    taxes,
    debt,
    savings,
    other,
    living,
    net: income + portfolioDraw - taxes - debt - savings - other - living,
    cashOnHand: 10_000 + 700 * (i + 1),
    ...over,
  };
}

const twelveMonths = () => Array.from({ length: 12 }, (_, i) => monthRow(i));

describe("buildMonthAllocationChartData", () => {
  it("labels the x axis with the twelve months, in order", () => {
    const d = buildMonthAllocationChartData(twelveMonths(), "dark");
    expect(d.labels).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });

  // Derived from the rows rather than from a twelve-name constant. A constant is
  // a second source of truth: hand it anything but twelve rows and every bar
  // points at the wrong month while the chart still draws.
  it("labels only the months it was actually given", () => {
    const d = buildMonthAllocationChartData([monthRow(6), monthRow(7)], "dark");
    expect(d.labels).toEqual(["Jul", "Aug"]);
    expect(d.datasets.find((x) => x.label === "Income")!.data).toHaveLength(2);
  });

  it("draws the committed costs as a stack and income as a line, like the year chart", () => {
    const rows = twelveMonths();
    const d = buildMonthAllocationChartData(rows, "dark");
    const income = d.datasets.find((s) => s.label === "Income")!;

    expect(income.type).toBe("line");
    expect(income.data).toEqual(rows.map((r) => r.income));
    // Living is the band the month view exists to break out; the year chart
    // folds it inside Available.
    expect(d.datasets.some((s) => s.type === "bar" && s.label === "Living")).toBe(true);
  });

  it("feeds each band its own field, never an aggregate", () => {
    const rows = twelveMonths();
    const d = buildMonthAllocationChartData(rows, "dark");
    const band = (label: string) => d.datasets.find((s) => s.label === label)!.data;

    expect(band("Taxes")).toEqual(rows.map((r) => r.taxes));
    expect(band("Debt")).toEqual(rows.map((r) => r.debt));
    expect(band("Savings")).toEqual(rows.map((r) => r.savings));
    expect(band("Other")).toEqual(rows.map((r) => r.other));
    expect(band("Living")).toEqual(rows.map((r) => r.living));
  });

  // THE invariant, ported from the year chart's own test above. That chart's
  // docblock says the gap between the income line and the top of the stack IS
  // the portfolio draw, and the toggle is not allowed to change how the picture
  // is read. A stack of costs alone does not sum to income + draw, so the
  // residual band is what makes the identity hold.
  it("makes the bar total exceed the income line by exactly the draw, every month", () => {
    const rows = twelveMonths();
    const d = buildMonthAllocationChartData(rows, "dark");
    const bars = d.datasets.filter((s) => s.type === "bar");
    const income = d.datasets.find((s) => s.type === "line")!;

    // Liveness for the identity: with a band held flat across the months,
    // misalignment inside it is invisible.
    for (const bar of bars) {
      expect(new Set(bar.data).size, `${bar.label} must vary month to month`).toBe(12);
    }

    rows.forEach((r, i) => {
      const barTotal = bars.reduce((s, b) => s + b.data[i], 0);
      expect(barTotal - income.data[i], `${r.label}`).toBeCloseTo(r.portfolioDraw, 6);
    });
  });

  // The toggle changes the PERIOD, not the way the chart is read. An advisor who
  // has learned that green is what is left over must not find it on Living.
  it("keeps every shared category on the colour the year chart gave it", () => {
    const d = buildMonthAllocationChartData(twelveMonths(), "dark");
    const colorOf = (label: string) => d.datasets.find((s) => s.label === label)!.backgroundColor;

    expect(colorOf("Taxes")).toBe(brandData.red);
    expect(colorOf("Debt")).toBe(brandData.orange);
    expect(colorOf("Savings")).toBe(brandData.blue);
    expect(colorOf("Other")).toBe(brandData.grey);
    // Green is the residual in both charts — Available there, Left over here.
    expect(colorOf("Living")).toBe(brandData.purple);
    expect(colorOf("Left over")).toEqual(Array(12).fill(brandData.green));
  });

  it("resolves the palette against the requested theme", () => {
    const d = buildMonthAllocationChartData(twelveMonths(), "light");
    expect(d.datasets.find((s) => s.label === "Taxes")!.backgroundColor).toBe(brandDataLight.red);
    expect(d.datasets.find((s) => s.label === "Income")!.borderColor).toBe(colorsLight.ink);
  });

  // Same line, same bars. Both builders now share one `incomeLine` constructor,
  // so this is a tripwire rather than a drift detector: it reds if anyone
  // restates the line inline in either builder and gets a value wrong, which is
  // exactly how the two would come apart. The bar half is NOT structurally
  // shared — each builder writes its own `stack` and `order` — so that half is
  // still detecting real drift.
  it("styles the line and the bars exactly as the year chart does", () => {
    const rows = twelveMonths();
    const month = buildMonthAllocationChartData(rows, "dark");
    const year = buildMonthlyCashFlowChartData([row()], "dark");

    const mLine = month.datasets.find((s) => s.type === "line")!;
    const yLine = year.datasets.find((s) => s.type === "line")!;
    expect({
      pointRadius: mLine.pointRadius,
      tension: mLine.tension,
      order: mLine.order,
      borderWidth: mLine.borderWidth,
      borderColor: mLine.borderColor,
      fill: mLine.fill,
    }).toEqual({
      pointRadius: yLine.pointRadius,
      tension: yLine.tension,
      order: yLine.order,
      borderWidth: yLine.borderWidth,
      borderColor: yLine.borderColor,
      fill: yLine.fill,
    });

    const yBar = year.datasets.find((s) => s.type === "bar")!;
    for (const bar of month.datasets.filter((s) => s.type === "bar")) {
      expect({ stack: bar.stack, order: bar.order }, bar.label).toEqual({
        stack: yBar.stack,
        order: yBar.order,
      });
    }
  });

  // The month the household is short is the whole reason this view exists. A
  // negative Left over is also the only band in the chart drawn below the zero
  // line, so the warning survives greyscale and colour-blindness on position
  // alone — the stain is the glance, not the only carrier.
  it("stains a short month's Left over band, and only that month", () => {
    const rows = twelveMonths();
    rows[10] = monthRow(10, { living: 40_000 });
    const d = buildMonthAllocationChartData(rows, "dark");
    const leftOver = d.datasets.find((s) => s.label === "Left over")!;

    expect(leftOver.data[10]).toBeLessThan(0);
    expect(leftOver.backgroundColor).toEqual(
      Array.from({ length: 12 }, (_, i) => (i === 10 ? colors.crit : brandData.green)),
    );
  });

  it("holds the identity in a short month too, rather than clamping the residual", () => {
    const rows = twelveMonths();
    rows[10] = monthRow(10, { living: 40_000 });
    const d = buildMonthAllocationChartData(rows, "dark");
    const bars = d.datasets.filter((s) => s.type === "bar");
    const income = d.datasets.find((s) => s.type === "line")!;

    const barTotal = bars.reduce((s, b) => s + b.data[10], 0);
    expect(barTotal - income.data[10]).toBeCloseTo(rows[10].portfolioDraw, 6);
  });
});

// The three behaviours that index `rows` — a PLAN-YEAR array — by the category
// index. In month view that index is 0-11 for January-December, so every one of
// them silently names an unrelated plan year. They are helpers rather than
// inline expressions for the same reason `applySelectedYearOutline` is: the
// component cannot be rendered in this suite, and these are the bugs worth
// catching.
describe("the year-indexed behaviours go inert in month view", () => {
  const rows = [row({ year: 2026 }), row({ year: 2027, depleted: true }), row({ year: 2028 })];

  it("selects the clicked year across the plan, and no year at all in month view", () => {
    expect(clickedYear(rows, 1, false)).toBe(2027);
    // Clicking February would otherwise jump the panel to the SECOND PLAN YEAR.
    expect(clickedYear(rows, 1, true)).toBeNull();
    expect(clickedYear(rows, 9, false)).toBeNull();
  });

  it("outlines the selected year across the plan, and nothing in month view", () => {
    expect(selectedYearIndex(rows, 2028, false)).toBe(2);
    expect(selectedYearIndex(rows, 2028, true)).toBe(-1);
    expect(selectedYearIndex(rows, null, false)).toBe(-1);
  });

  it("reports depletion by year across the plan, and never by month index", () => {
    expect(depletedAt(rows, 1, false)).toBe(true);
    // Month 2 of a healthy year is not depleted just because plan year 2 is.
    expect(depletedAt(rows, 1, true)).toBe(false);
    expect(depletedAt(rows, 0, false)).toBe(false);
  });
});

// The three helpers above are only worth having if the component actually routes
// through them; reverting it to the inline expressions would leave every one of
// those tests green while the month chart went back to selecting plan years off
// a month index. The behaviour is not renderable from this suite — Chart.js
// needs a canvas — so the guard is on the source.
describe("the chart component routes the year-indexed lookups through the helpers", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/charts/solver-monthly-cash-flow-chart.tsx"),
    "utf8",
  );

  it("calls all three", () => {
    for (const fn of ["clickedYear(", "selectedYearIndex(", "depletedAt("]) {
      expect(source.split(fn).length - 1, fn).toBeGreaterThanOrEqual(2); // declaration + call
    }
  });

  it("keeps no inline year lookup of its own", () => {
    expect(source).not.toMatch(/rows\[elements\[0\]\.index\]/);
    expect(source).not.toMatch(/rows\[ctx\.dataIndex\]/);
  });
});
