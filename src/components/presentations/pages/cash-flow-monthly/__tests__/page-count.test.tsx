import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SHORT_DISCLAIMER } from "@/lib/presentations/disclaimers";
import { BBOX_EPS, renderedPages, wordBoxes, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { PAGE_PAD_X, PAGE_WIDTH_PORTRAIT } from "@/components/presentations/shared/page-frame";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { buildMonthlyCashFlowPageData } from "@/lib/presentations/pages/cash-flow-monthly/view-model";
import { estimateMonthlyCashFlowPageCount, DISTRIBUTIONS_ROWS_PER_PAGE } from "@/lib/presentations/pages/cash-flow-monthly/options-schema";
import {
  DISTRIBUTIONS_CHART_HEIGHT,
  distributionsCardHeight,
  distributionsChartPlacement,
} from "@/lib/presentations/pages/cash-flow-monthly/distributions-layout";
import type { MonthlyCashFlowPageData, MonthlyCashFlowPageOptions } from "@/lib/presentations/pages/cash-flow-monthly/types";
import { makeRealDistributionsFixture } from "@/lib/presentations/pages/cash-flow-monthly/__tests__/real-fixture";
import { distributionCardLines } from "@/lib/solver/distribution-card-lines";
import type { DistributionRow } from "@/lib/solver/monthly-distributions";
import { MonthlyCashFlowPagePdf } from "../page-pdf";

const { clientData, years } = makeRealDistributionsFixture();

/** The frame's 72pt bottom padding is the only thing keeping body content out
 *  of the footer band; nothing of the body may print below it. */
const BODY_BOTTOM = 792 - 72;
const RIGHT_MARGIN = PAGE_WIDTH_PORTRAIT - PAGE_PAD_X;
const FOOTER_WORDS = new Set([
  ...SHORT_DISCLAIMER.split(/\s+/),
  "Confidential",
  "·",
  "Personal",
  "Page",
  "of",
]);

function build(range: MonthlyCashFlowPageOptions["range"] = "full") {
  const options: MonthlyCashFlowPageOptions = {
    view: "plan", basis: "today", range, year: null, mode: "distributions",
  };
  const data = buildMonthlyCashFlowPageData({
    years, clientData, options, scenarioLabel: "Base Case", clientName: "John", spouseName: "Jane",
  });
  return { data, options };
}

/** `rows` printed rows: the fixture's 30 years, repeated over more years. */
function stretched(data: MonthlyCashFlowPageData, rows: number): MonthlyCashFlowPageData {
  const dist = data.distribution!;
  return {
    ...data,
    distribution: {
      ...dist,
      rows: Array.from({ length: rows }, (_, i) => ({ ...dist.rows[i % dist.rows.length], year: 2000 + i })),
    },
  };
}

/** The page as the view-model would build it around `summary`: the chart's
 *  height and sheet come from the same `distributionsChartPlacement`. */
function withSummary(data: MonthlyCashFlowPageData, summary: DistributionRow): MonthlyCashFlowPageData {
  const chart = distributionsChartPlacement(summary);
  return {
    ...data,
    distribution: { ...data.distribution!, summary, chartOnOwnSheet: chart.ownSheet },
    chartSpec: { ...data.chartSpec!, height: chart.height },
  };
}

async function render(data: MonthlyCashFlowPageData, options: MonthlyCashFlowPageOptions) {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      <MonthlyCashFlowPagePdf
        data={data} firmName="Firm" clientName="John" reportDate="Oct 30, 2026"
        pageIndex={1} totalPages={2} accent={SECTION_ACCENTS["Cash Flow"]}
      />
    </Document>,
  );
  const pages = renderedPages(buf);
  return {
    buf,
    pages,
    estimate: estimateMonthlyCashFlowPageCount(data, options),
    sheets: Array.from({ length: pages }, (_, i) => wordBoxes(buf, i + 1)),
  };
}

/** Nothing printed over the footer band, nothing past the right margin. */
function expectInsideTheFrame(sheets: Word[][]) {
  sheets.forEach((words, i) => {
    for (const w of words) {
      if (w.yMax > BODY_BOTTOM + BBOX_EPS) {
        expect(FOOTER_WORDS.has(w.text) || /^\d+$/.test(w.text), `sheet ${i + 1}: "${w.text}" at y ${w.yMax}`)
          .toBe(true);
      }
      expect(w.xMax, `sheet ${i + 1}: "${w.text}"`).toBeLessThanOrEqual(RIGHT_MARGIN + BBOX_EPS);
    }
  });
}

/** A year card at the heavy end of real plans: six accounts (one borrowed on
 *  margin), three goals each with a general-account part and a shortfall, two
 *  QCD notes, a goal need line, two income sources, a depleted banner. */
function heavySummary(base: DistributionRow): DistributionRow {
  const names = ["Rollover IRA", "Joint Brokerage", "Jane Roth IRA", "Emergency Fund", "Trust Checking", "John 401(k)"];
  return {
    ...base,
    depleted: true,
    need: {
      ...base.need,
      insurance: 400,
      other: 300,
      savings: 200,
      goalLines: [{ expenseId: "car", name: "New car", amount: 2_000 }],
    },
    income: {
      total: 5_000,
      sources: [
        { label: "Social Security", amount: 3_000 },
        { label: "Annuity", amount: 2_000 },
      ],
    },
    fromAccounts: {
      ...base.fromAccounts,
      total: 15_500,
      accounts: names.map((name, i) => ({
        accountId: `a${i}`,
        name,
        amount: 5_000 - i * 900,
        annualNominal: (5_000 - i * 900) * 12,
        borrowed: i === 0 ? 500 : 0,
      })),
      parts: { spending: 9_000, taxes: 3_000, goalShortfall: 900, surplusSpent: 0, absorbedExtra: 0, keptOrReinvested: 0 },
      unexplained: -2_500,
    },
    goals: [1, 2, 3].map((i) => ({
      goalId: `g${i}`,
      name: `Goal ${i}`,
      setAsideAccountNames: [`Goal Savings ${i}`],
      fromSetAside: 1_000,
      fromGeneral: 300,
      unfunded: 120,
    })),
    qcds: [
      { accountId: "a0", name: "Rollover IRA", amount: 400 },
      { accountId: "a5", name: "John 401(k)", amount: 300 },
    ],
  };
}

describe("Distributions page count", () => {
  it("is exactly 1 sheet when the range holds no years, and the estimate agrees", async () => {
    const { data, options } = build({ startYear: 1990, endYear: 1990 });
    const r = await render(data, options);
    expect(data.distribution!.rows).toHaveLength(0);
    expect(r.pages).toBe(1);
    expect(r.estimate).toBe(1);
  });

  it("is exactly 2 sheets for a one-year range, and the estimate agrees", async () => {
    const { data, options } = build({ startYear: 2030, endYear: 2030 });
    const r = await render(data, options);
    expect(data.distribution!.rows).toHaveLength(1);
    expect(r.pages).toBe(2);
    expect(r.estimate).toBe(2);
  });

  // Sheets break after exactly DISTRIBUTIONS_ROWS_PER_PAGE rows. 37–38 rows
  // once fit two sheets by flowing while the estimate said three, shifting
  // every later page number in the deck.
  it.each([
    [DISTRIBUTIONS_ROWS_PER_PAGE, 2],
    [DISTRIBUTIONS_ROWS_PER_PAGE + 1, 3],
    [DISTRIBUTIONS_ROWS_PER_PAGE + 2, 3],
    [DISTRIBUTIONS_ROWS_PER_PAGE * 2, 3],
    [DISTRIBUTIONS_ROWS_PER_PAGE * 2 + 1, 4],
  ])("prints %i rows on exactly %i sheets, and the estimate agrees", async (rows, sheets) => {
    const { data, options } = build();
    const r = await render(stretched(data, rows), options);
    expect(r.pages).toBe(sheets);
    expect(r.estimate).toBe(sheets);
    expectInsideTheFrame(r.sheets);
  });

  it("a full sheet of rows, a three-line header and both notes still clear the footer", async () => {
    const { data, options } = build();
    const dist = data.distribution!;
    // Long account names wrap the header to its three-line cap.
    const long = "Checking accounts, cash and certificates of deposit";
    const full = stretched(
      { ...data, distribution: { ...dist, columns: dist.columns.map((c) => ({ ...c, name: long })) } },
      DISTRIBUTIONS_ROWS_PER_PAGE,
    );
    expect(full.notes.length).toBe(2); // the depleted note and the taxes-and-goals note
    const r = await render(full, options);
    expect(r.pages).toBe(r.estimate);
    expectInsideTheFrame(r.sheets);
    // The last note and the footnote are on the table sheet, above the footer.
    const last = r.sheets.at(-1)!;
    expect(last.some((w) => w.text === "hypothetical" && w.yMax <= BODY_BOTTOM)).toBe(true);
  });
}, 120_000);

describe("Distributions sheet layout", () => {
  it("gives every table sheet a heading, and right-aligned header cells a gutter", async () => {
    const { data, options } = build();
    const r = await render(stretched(data, DISTRIBUTIONS_ROWS_PER_PAGE + 1), options);
    const heads = r.sheets.slice(1).map((words) =>
      words.filter((w) => w.yMin < 130).map((w) => w.text).join(" "),
    );
    expect(heads[0]).toContain("Distributions across the plan Per month");
    expect(heads[1]).toContain("Distributions across the plan (continued)");
    // Neighbouring header cells used to print flush ("accounts|IRA accounts").
    // A space inside a cell is ~1.8pt at 6.5pt; between cells it is 6pt.
    const header = r.sheets[1].filter((w) => w.yMin > 100 && w.yMin < 140 && w.yMax < 140);
    const byLine = Map.groupBy(header, (w) => Math.round(w.yMin));
    for (const line of byLine.values()) {
      const sorted = [...line].sort((a, b) => a.xMin - b.xMin);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].xMin - sorted[i - 1].xMax, `${sorted[i - 1].text}|${sorted[i].text}`)
          .toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("prints the chart's legend note on page 1, and the card the screen shows", async () => {
    const { data, options } = build();
    const r = await render(data, options);
    const page1 = r.sheets[0].map((w) => w.text).join(" ");
    expect(page1).toContain("The part of each bar above the Spending need line pays taxes");
    // The printed card reads the screen panel's own lines.
    const card = distributionCardLines(data.distribution!.summary!);
    for (const l of card.needLines) expect(page1).toContain(l.label);
    expect(page1).toContain(card.madeOfText);
    for (const a of card.accounts) expect(page1).toContain(a.name);
    expectInsideTheFrame(r.sheets);
  });

  it("estimates a card's height from above: never shorter than it prints", async () => {
    const { data, options } = build({ startYear: 2030, endYear: 2030 });
    const summaries = [data.distribution!.summary!, heavySummary(data.distribution!.summary!)];
    for (const summary of summaries) {
      // Card alone on page 1 (no chart), measured from its top edge to its last line.
      const r = await render({ ...withSummary(data, summary), chartSpec: undefined }, options);
      const page1 = r.sheets[0];
      const cardTop = page1.find((w) => w.text === String(summary.year))!.yMin - 9;
      const cardBottom = Math.max(...page1.filter((w) => w.yMax < BODY_BOTTOM).map((w) => w.yMax)) + 13;
      const printed = cardBottom - cardTop;
      expect(distributionsCardHeight(summary)).toBeGreaterThanOrEqual(printed);
      // …and not so far above it that a fitting chart gets pushed off the page.
      expect(distributionsCardHeight(summary) - printed).toBeLessThan(60);
    }
  });

  it("a plain card keeps the full-height chart on page 1", () => {
    const { data } = build();
    expect(distributionsChartPlacement(data.distribution!.summary!)).toEqual({
      height: DISTRIBUTIONS_CHART_HEIGHT,
      ownSheet: false,
    });
    expect(data.chartSpec!.height).toBe(DISTRIBUTIONS_CHART_HEIGHT);
    expect(data.distribution!.chartOnOwnSheet).toBe(false);
  });

  // M4: page 1 is ONE sheet in the deck's count. A card this heavy used to
  // push the chart onto a sheet nobody counted, renumbering the rest of the deck.
  it("a fuller card shrinks the chart to the room left on page 1", async () => {
    const { data, options } = build();
    const heavy = heavySummary(data.distribution!.summary!);
    const fuller: DistributionRow = { ...heavy, goals: heavy.goals.slice(0, 2), qcds: heavy.qcds.slice(0, 1) };
    const placed = withSummary(data, fuller);
    expect(placed.distribution!.chartOnOwnSheet).toBe(false);
    expect(placed.chartSpec!.height).toBeLessThan(DISTRIBUTIONS_CHART_HEIGHT);
    const r = await render(placed, options);
    expect(r.pages).toBe(2);
    expect(r.estimate).toBe(2);
    expectInsideTheFrame(r.sheets);
    expect(r.sheets[0].map((w) => w.text).join(" ")).toContain("above the Spending need line");
  });

  it("a heavy card moves the chart to a sheet of its own, and the count says so", async () => {
    const { data, options } = build();
    const placed = withSummary(data, heavySummary(data.distribution!.summary!));
    expect(placed.distribution!.chartOnOwnSheet).toBe(true);
    const r = await render(placed, options);
    expect(r.pages).toBe(3);
    expect(r.estimate).toBe(3);
    expectInsideTheFrame(r.sheets);
    // The chart's sheet carries a head and the legend note; page 1 has neither chart nor note.
    const chartSheet = r.sheets[1].map((w) => w.text).join(" ");
    expect(chartSheet).toContain("Monthly Cash Flow (continued)");
    expect(chartSheet).toContain("The part of each bar above the Spending need line");
    expect(r.sheets[0].map((w) => w.text).join(" ")).not.toContain("above the Spending need line");
  });
}, 120_000);
