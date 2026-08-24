import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { EarlyYearsHumanCapitalPagePdf } from "../early-years-human-capital/page-pdf";
import { EarlyYearsLadderPagePdf } from "../early-years-ladder/page-pdf";
import { EarlyYearsWaitingPagePdf } from "../early-years-waiting/page-pdf";
import { EarlyYearsRothPagePdf } from "../early-years-roth/page-pdf";
import { EarlyYearsDebtOrInvestPagePdf } from "../early-years-debt-or-invest/page-pdf";
import type { DollarPair } from "@/lib/presentations/real-dollars";
import type { Tidbit } from "@/lib/presentations/tidbits";
import type { EarlyYearsHumanCapitalPageData } from "@/lib/presentations/pages/early-years-human-capital/types";
import type { EarlyYearsLadderPageData } from "@/lib/presentations/pages/early-years-ladder/types";
import type { EarlyYearsWaitingPageData } from "@/lib/presentations/pages/early-years-waiting/types";
import type { EarlyYearsRothPageData } from "@/lib/presentations/pages/early-years-roth/types";
import type { EarlyYearsDebtOrInvestPageData } from "@/lib/presentations/pages/early-years-debt-or-invest/types";
import { estimateEarlyYearsHumanCapitalPageCount } from "@/lib/presentations/pages/early-years-human-capital/estimate-page-count";
import { estimateEarlyYearsLadderPageCount } from "@/lib/presentations/pages/early-years-ladder/estimate-page-count";
import { estimateEarlyYearsWaitingPageCount } from "@/lib/presentations/pages/early-years-waiting/estimate-page-count";
import { estimateEarlyYearsRothPageCount } from "@/lib/presentations/pages/early-years-roth/estimate-page-count";
import { estimateEarlyYearsDebtOrInvestPageCount } from "@/lib/presentations/pages/early-years-debt-or-invest/estimate-page-count";
import { exactCurrency } from "@/lib/presentations/format";

const FRAME = {
  firmName: "Ethos Financial Group",
  clientName: "Maximum Layout Household",
  reportDate: "August 20, 2026",
  pageIndex: 4,
  totalPages: 8,
  accent: SECTION_ACCENTS["Early Years"],
};

const TIDBITS: Tidbit[] = [
  {
    id: "layout-proof-one",
    title: "Time is the ingredient you cannot buy again once it has passed",
    body: "A steady contribution has years to compound before the goal arrives. This deliberately long educational note exercises the narrow sidebar at its supported density while the figures and detail rows occupy the main column beside it.",
    topic: "compounding",
  },
  {
    id: "layout-proof-two",
    title: "A plan is most useful when the details remain easy to inspect",
    body: "Checkpoint figures make the path concrete without turning the page into a spreadsheet. This second deliberately long note proves that two sidebar cards and the final table row can share one Letter sheet without clipping.",
    topic: "behavior",
  },
];

function pair(today: number, year: number): DollarPair {
  return {
    today,
    nominal: Math.round(today * 1.024 ** (year - 2026)),
  };
}

const human: EarlyYearsHumanCapitalPageData = {
  subtitle: "Base Case · Today's dollars first · Future-year dollars beneath",
  isEmpty: false,
  invested: pair(48_000, 2026),
  lifetimeEarnings: { today: 3_120_000, nominal: 5_040_000 },
  multiple: 65,
  lastEarningYear: 2071,
  takeaway:
    "About $3.1M today ($5.0M future-year dollars) of future pay will pass through your hands. That is roughly 65 times what you have invested today.",
  detailRows: Array.from({ length: 10 }, (_, index) => {
    const year = index === 9 ? 2071 : 2026 + index * 5;
    return { year, age: 29 + year - 2026, salary: pair(120_000, year) };
  }),
  tidbits: TIDBITS,
};

const rungs = [
  { percent: 0.08, label: "Save 8%", isCurrent: true },
  { percent: 0.11, label: "Save 11%", isCurrent: false },
  { percent: 0.14, label: "Save 14%", isCurrent: false },
  { percent: 0.17, label: "Save 17%", isCurrent: false },
];

const ladder: EarlyYearsLadderPageData = {
  subtitle: human.subtitle,
  groups: [40, 50, 60, 65].map((age) => ({
    age,
    year: 2026 + age - 29,
    bars: rungs.map((rung, index) => ({
      label: rung.label,
      isCurrent: rung.isCurrent,
      value: pair((age - 25) * 60_000 + index * 125_000, 2026 + age - 29),
    })),
  })),
  rungs,
  cappedRungLabels: ["Save 17%"],
  takeaway:
    "At age 65, the Save 17% bar is about $700K today ($2.0M future-year dollars) ahead of Save 8% (current plan).",
  emptyMessage: null,
  tidbits: TIDBITS,
  basis: { inflationRate: 0.024, planStartYear: 2026 },
};

const waiting: EarlyYearsWaitingPageData = {
  subtitle: human.subtitle,
  groups: [40, 50, 60, 65].map((age) => ({
    age,
    year: 2026 + age - 29,
    bars: [0, 1, 2, 3].map((index) => ({
      value: pair((age - 25) * 55_000 - index * 80_000, 2026 + age - 29),
    })),
  })),
  seriesLabels: ["Start now", "Start in 5 years", "Start in 10 years", "Start in 15 years"],
  raisedRate: 0.11,
  takeaway:
    "Waiting five years leaves about $250K today ($720K future-year dollars) less at age 65.",
  isCapped: true,
  emptyMessage: null,
  tidbits: TIDBITS,
  basis: { inflationRate: 0.024, planStartYear: 2026 },
};

const roth: EarlyYearsRothPageData = {
  subtitle: human.subtitle,
  rows: [
    ["Tax paid while you're working", 612_000, 741_000],
    ["Tax paid from retirement on", 388_000, 106_000],
    ["Tax over the whole plan", 1_000_000, 847_000],
    ["Average yearly spending in retirement", 72_000, 72_000],
  ].map(([label, traditional, allRoth]) => ({
    label: String(label),
    traditional: { today: Number(traditional), nominal: Number(traditional) * 2 },
    roth: { today: Number(allRoth), nominal: Number(allRoth) * 2 },
    betterIsLower: label !== "Average yearly spending in retirement",
  })),
  detailRows: Array.from({ length: 14 }, (_, index) => {
    const year = index === 13 ? 2091 : 2026 + index * 5;
    return {
      year,
      age: 29 + year - 2026,
      traditionalTax: pair(20_000 - index * 400, year),
      rothTax: pair(24_000 - index * 700, year),
    };
  }),
  takeaway:
    "Over the whole plan, all-Roth contributions leave about $153,000 today ($510,000 future-year dollars) less tax paid.",
  spendingIsFixed: true,
  emptyMessage: null,
  tidbits: TIDBITS,
};

const debt: EarlyYearsDebtOrInvestPageData = {
  subtitle: human.subtitle,
  liabilityName: "student loan",
  monthlyAmount: 500,
  milestoneAge: 65,
  loan: {
    label: "Onto the loan",
    debtFreeYear: 2032,
    interestPaid: { today: 6_600, nominal: 7_200 },
    portfolioAtMilestone: pair(930_000, 2062),
  },
  invest: {
    label: "Into the 401(k)",
    debtFreeYear: 2037,
    interestPaid: { today: 14_000, nominal: 17_800 },
    portfolioAtMilestone: pair(985_000, 2062),
  },
  detailRows: Array.from({ length: 12 }, (_, index) => {
    const year = index === 11 ? 2081 : 2026 + index * 5;
    return {
      year,
      age: 29 + year - 2026,
      loanBalance: pair(Math.max(0, 30_000 - index * 3_000), year),
      investBalance: pair(Math.max(0, 30_000 - index * 2_500), year),
    };
  }),
  takeaway:
    'By age 65, "Into the 401(k)" leaves about $55K today ($159K future-year dollars) more.',
  emptyMessage: null,
  tidbits: TIDBITS,
};

const CONTENT_BOTTOM = 720;
const MAX_RIGHT_EDGE_DRIFT = 1;

type PdfLine = {
  text: string;
  xMax: number;
  yMin: number;
};

function pdfLines(bbox: string): PdfLine[] {
  return [
    ...bbox.matchAll(
      /<line xMin="[\d.-]+" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="[\d.-]+">([\s\S]*?)<\/line>/g,
    ),
  ].map((match) => ({
    yMin: Number(match[1]),
    xMax: Number(match[2]),
    text: [...match[3].matchAll(/<word [^>]*>(.*?)<\/word>/g)]
      .map((word) => word[1])
      .join(" "),
  }));
}

function expectDualDollarRightEdgesAligned(
  name: string,
  bbox: string,
  values: readonly DollarPair[],
) {
  const lines = pdfLines(bbox);
  const usedPrimary = new Set<number>();
  const usedSecondary = new Set<number>();
  const drifts = values
    // A pair whose two units round to the same number renders ONE line, so
    // there is no second right edge to align. See `DualDollarValuePdf`.
    .filter((value) => Math.round(value.today) !== Math.round(value.nominal))
    .map((value) => {
      const primaryText = exactCurrency(value.today);
      const secondaryText = exactCurrency(value.nominal);
      const primaryCandidates = lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line, index }) =>
            line.text === primaryText && !usedPrimary.has(index),
        );
      const secondaryCandidates = lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line, index }) =>
            line.text === secondaryText && !usedSecondary.has(index),
        );
      const match = primaryCandidates
        .flatMap((primary) =>
          secondaryCandidates.map((secondary) => ({
            primary,
            secondary,
            verticalGap: secondary.line.yMin - primary.line.yMin,
            drift: Math.abs(secondary.line.xMax - primary.line.xMax),
          })),
        )
        .filter(({ verticalGap }) => verticalGap > 0 && verticalGap < 16)
        .sort((a, b) => a.drift - b.drift)[0];

      expect(
        match,
        `${name} must expose bbox lines for ${primaryText}`,
      ).toBeDefined();
      usedPrimary.add(match!.primary.index);
      usedSecondary.add(match!.secondary.index);
      return match!.drift;
    });

  expect(
    drifts,
    `${name} must exercise rendered dual-dollar cells`,
  ).not.toHaveLength(0);
  expect(
    Math.max(...drifts),
    `${name} dual-dollar line xMax drift (${drifts.map((drift) => drift.toFixed(3)).join(", ")}pt)`,
  ).toBeLessThanOrEqual(MAX_RIGHT_EDGE_DRIFT);
}

async function inspect(
  name: string,
  lastYear: number,
  page: ReturnType<typeof EarlyYearsHumanCapitalPagePdf>,
  dualDollarValues: readonly DollarPair[],
) {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(<Document>{page}</Document>);
  const dir = mkdtempSync(join(tmpdir(), `early-years-${name}-`));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    let layout: string;
    let bbox: string;
    try {
      layout = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
      bbox = execFileSync("pdftotext", ["-bbox-layout", file, "-"], { encoding: "utf8" });
    } catch (cause) {
      throw new Error(
        "this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }

    const pages = layout.split("\f").filter((part) => part.trim().length > 0);
    const lastRowBoxes = bbox
      .split("\n")
      .map((line) =>
        /<word xMin="[\d.-]+" yMin="[\d.-]+" xMax="[\d.-]+" yMax="([\d.-]+)">(.*)<\/word>/.exec(
          line,
        ),
      )
      .filter((match): match is RegExpExecArray => match != null && match[2] === String(lastYear))
      .map((match) => Number(match[1]));

    expect(
      pages,
      `${name} must stay on exactly one sheet; overflow: ${pages[1]?.replace(/\s+/g, " ").trim()}`,
    ).toHaveLength(1);
    expect(layout, `${name} must print its final detail row`).toContain(String(lastYear));
    expect(lastRowBoxes, `${name} final row must have PDF geometry`).not.toHaveLength(0);
    expect(Math.max(...lastRowBoxes), `${name} final row must stay above the footer`).toBeLessThan(
      CONTENT_BOTTOM,
    );
    expectDualDollarRightEdgesAligned(name, bbox, dualDollarValues);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Your Early Years maximum detail geometry", () => {
  it.each([
    [
      "human-capital",
      2071,
      EarlyYearsHumanCapitalPagePdf({ data: human, ...FRAME }),
      human.detailRows.map((row) => row.salary),
    ],
    [
      "ladder",
      2062,
      EarlyYearsLadderPagePdf({ data: ladder, ...FRAME }),
      ladder.groups.flatMap((group) => group.bars.map((bar) => bar.value)),
    ],
    [
      "waiting",
      2062,
      EarlyYearsWaitingPagePdf({ data: waiting, ...FRAME }),
      waiting.groups.flatMap((group) => group.bars.map((bar) => bar.value)),
    ],
    [
      "roth",
      2091,
      EarlyYearsRothPagePdf({ data: roth, ...FRAME }),
      [
        ...roth.rows.flatMap((row) => [row.traditional, row.roth]),
        ...roth.detailRows.flatMap((row) => [row.traditionalTax, row.rothTax]),
      ],
    ],
    [
      "debt-or-invest",
      2081,
      EarlyYearsDebtOrInvestPagePdf({ data: debt, ...FRAME }),
      debt.detailRows.flatMap((row) => [row.loanBalance, row.investBalance]),
    ],
  ] as const)(
    "prints the %s final row on one Letter sheet and aligns every dual-dollar cell",
    inspect,
    30_000,
  );

  it("keeps supported maxima at one sheet and counts overflow honestly", () => {
    expect(estimateEarlyYearsHumanCapitalPageCount(human)).toBe(1);
    expect(estimateEarlyYearsHumanCapitalPageCount({
      ...human,
      detailRows: [...human.detailRows, human.detailRows[0]],
    })).toBe(2);

    expect(estimateEarlyYearsLadderPageCount(ladder)).toBe(1);
    expect(estimateEarlyYearsLadderPageCount({
      ...ladder,
      groups: [...ladder.groups, ladder.groups[0]],
    })).toBe(2);

    expect(estimateEarlyYearsWaitingPageCount(waiting)).toBe(1);
    expect(estimateEarlyYearsWaitingPageCount({
      ...waiting,
      groups: [...waiting.groups, waiting.groups[0]],
    })).toBe(2);

    expect(estimateEarlyYearsRothPageCount(roth)).toBe(1);
    expect(estimateEarlyYearsRothPageCount({
      ...roth,
      detailRows: [...roth.detailRows, roth.detailRows[0]],
    })).toBe(2);

    expect(estimateEarlyYearsDebtOrInvestPageCount(debt)).toBe(1);
    expect(estimateEarlyYearsDebtOrInvestPageCount({
      ...debt,
      detailRows: [...debt.detailRows, debt.detailRows[0]],
    })).toBe(2);
  });
});
