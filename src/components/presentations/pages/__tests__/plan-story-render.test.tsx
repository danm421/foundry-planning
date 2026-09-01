// A real @react-pdf render of the story pages. Two things are invisible to
// every other test in this suite and only the layout engine can see them:
//
//   1. react-pdf auto-breaks a `<Page>` whose content exceeds the content box,
//      producing MORE physical sheets than `estimatePlanStoryPageCount`
//      reserved. `document.tsx` numbers the rest of the deck from that estimate,
//      so an extra sheet mis-numbers every page after the story.
//   2. An unregistered font FAMILY throws mid-render (measured: renaming
//      "Fraunces" fails this file, and nothing else in the suite notices). An
//      unregistered WEIGHT does not — react-pdf falls back silently — so
//      `title`'s 600 is a house-style choice no test can hold it to.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { estimatePlanStoryPageCount } from "@/lib/presentations/pages/plan-story/estimate-page-count";
import { PLAN_STORY_OPTIONS_DEFAULT, type PlanStoryOptions } from "@/lib/presentations/pages/plan-story/options-schema";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";
import {
  buildPlanStoryData,
  BUDGET_WORDS_CHART,
  BUDGET_WORDS_GLOSSARY,
  MAX_FIGURE_CARDS,
  MAX_GLOSSARY_TERMS,
  MAX_PARAGRAPHS,
  MAX_PARAGRAPHS_CHART,
  MAX_PARAGRAPHS_WITH_CARDS,
  MAX_STEPS,
  MAX_STRATEGY_CARDS,
  type PlanStoryPageData,
} from "@/lib/presentations/pages/plan-story/view-model";
import { GLOSSARY } from "@/lib/presentations/story/glossary";
import { pctFact, yearFact } from "@/lib/presentations/story/facts";

/** Eight sheets' worth — what a 20,000-character `editedText` buys. */
const LONG_PROSE = Array.from(
  { length: 60 },
  () => "Your plan holds through the years we modelled and leaves room to spare for the things you told us matter most.",
).join("\n\n");
import { PlanStoryPagePdf } from "../plan-story/page-pdf";

ensureFontsRegistered();

const FRAME = {
  firmName: "Foundry Wealth",
  clientName: "Alan & Teresa",
  reportDate: "August 12, 2026",
  pageIndex: 1,
  totalPages: 3,
  accent: DEFAULT_ACCENT,
};

/** The PDF's page-tree node — `<< /Type /Pages /Count n /Kids […] >>`, written
 *  uncompressed by pdfkit. The count react-pdf actually laid out, not the one we
 *  asked for. */
function renderedPages(pdf: Buffer): number {
  const match = /\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no page-tree node in the rendered PDF");
  return Number(match[1]);
}

async function pagesOf(data: PlanStoryPageData): Promise<number> {
  return renderedPages(
    await renderToBuffer(<Document>{PlanStoryPagePdf({ data, ...FRAME })}</Document>),
  );
}

/** A full proposed story at the length the chapter narrators actually write. */
const REALISTIC: PlanStoryPageData = {
  title: "Your Plan",
  subtitle: "Proposed — Retire at 63",
  isEmpty: false,
  emptyMessage: "",
  chapters: [
    {
      chapterId: "planInOnePage",
      title: "Your plan, in one page",
      layout: "heroProse",
      paragraphs: [
        "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — up from 84% on your current path.",
        "That comes from two changes: Delay Social Security and Roth conversions.",
        "You're starting from $2.4M.",
      ],
      strategies: [],
      figures: [],
      steps: [],
      glossary: [],
      chart: null,
      overflowNote: "",
    },
    {
      chapterId: "whatWerePlanningFor",
      title: "What we're planning for",
      layout: "twoUp",
      // What `narrateWhatWerePlanningFor` actually writes: the horizon, a
      // lead-in, then one short sentence per goal with the date in front.
      paragraphs: [
        "The plan runs from now to 2065, with work ending in 2041.",
        "Here's what you told us the money is for.",
        "In 2032, Maggie · State University.",
        "In 2036, A place at the lake.",
      ],
      strategies: [],
      figures: [
        { label: "The year you stop working", value: "2041" },
        { label: "The last year we plan to", value: "2065" },
      ],
      steps: [],
      glossary: [],
      chart: null,
      overflowNote: "",
    },
    {
      chapterId: "whatYouHave",
      title: "What you have",
      layout: "heroProse",
      paragraphs: [
        "You own $2.9M and owe $480K, which leaves $2.4M to your name.",
        "Not all of it is spendable: $1.6M sits in retirement accounts you can't reach without tax, and $620K is the house you live in.",
      ],
      strategies: [],
      figures: [],
      steps: [],
      glossary: [],
      chart: null,
      overflowNote: "",
    },
    {
      chapterId: "whatWeRecommend",
      title: "What we're recommending, and why",
      layout: "strategyCards",
      paragraphs: ["Two changes, and both are about timing rather than about taking more risk."],
      strategies: [
        { name: "Delay Social Security", what: "Alan's Social Security claim age", detail: "Claim age: 67 → 70" },
        {
          name: "Roth conversions",
          what: "Traditional IRA → Roth IRA, Teresa's Traditional IRA → Roth IRA",
          detail: "$50K/yr from Traditional IRA → Roth IRA · 2028–2033",
        },
      ],
      figures: [],
      steps: [],
      glossary: [],
      chart: null,
      overflowNote: "",
    },
  ],
};

/** One chapter carrying `cards` cards and `words` of prose — the shape the view
 *  model's budget is spent on, built at exactly the limits it allows. */
function worstCase(cards: number, words: number, overflowNote = ""): PlanStoryPageData {
  const SENTENCE =
    "Your plan holds through the years we modelled and leaves room to spare for the things you told us matter most to you now and later on. ";
  const perPara = 27;
  return {
    title: "Your Plan",
    subtitle: "Proposed",
    isEmpty: false,
    emptyMessage: "",
    chapters: [
      {
        chapterId: "whatWeRecommend",
        title: "What we're recommending, and why",
        layout: "strategyCards",
        paragraphs:
          words === 0
            ? []
            : Array.from({ length: Math.ceil(words / perPara) }, () => SENTENCE.trim()),
        strategies: Array.from({ length: cards }, (_, i) => ({
          name: `Convert to Roth through the 22% bracket ${i + 1}`,
          what: "Traditional IRA → Roth IRA, Teresa's Traditional IRA → Roth IRA",
          detail: "$50K/yr from Traditional IRA → Roth IRA · 2028–2033",
        })),
        figures: [],
        steps: [],
        glossary: [],
        chart: null,
        overflowNote,
      },
    ],
  };
}

/**
 * What `buildPlanStoryData` actually emits for a chapter with `cards` strategies
 * and far more prose than a sheet can hold — the real bound, run rather than
 * restated. A fixture that hardcoded the numbers would prove the renderer fits
 * SOME prose, not that it fits the prose the view model will hand it.
 */
function atTheBound(cards: number): PlanStoryPageData {
  return buildPlanStoryData(
    {
      planStory: {
        story: {
          household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
          scenarioLabel: "Proposed",
          documentRole: "standalone",
          hasProposal: true,
          goals: [],
          strategies: Array.from({ length: cards }, (_, i) => ({
            name: `Convert to Roth through the 22% bracket ${i + 1}`,
            rows: [
              {
                area: "Assets",
                what: "Traditional IRA → Roth IRA, Teresa's Traditional IRA → Roth IRA",
                op: "edit" as const,
                before: "—",
                after: "—",
                detail: [],
              },
            ],
          })),
          facts: [],
        },
        // Eight sheets of prose, which is what a 20,000-character `editedText`
        // buys. Every chapter gets it, so each one is squeezed to its own bound.
        text: {
          planInOnePage: LONG_PROSE,
          whatYouHave: LONG_PROSE,
          whatWeRecommend: LONG_PROSE,
        },
      },
      scenarioLabel: "Proposed",
    } as never,
    { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" },
  );
}

/**
 * The shape Wave F actually found on prod, which no fixture here could
 * produce: `narrateWhatWeRecommend` writes ONE SHORT PARAGRAPH PER STRATEGY.
 * Eleven strategies, four of them restating their cards and dropped, leaves
 * seven paragraphs of about ten words — 70 words against an 80-word budget and
 * seven paragraphs against a ceiling of eight, so every one of them prints and
 * the sheet spills on bottom margins the word count cannot see.
 *
 * `LONG_PROSE` is 21-word paragraphs, so the word budget cuts it at three and
 * the paragraph ceiling is never reached. That is why the shipped measurement
 * was green while the deck mis-numbered.
 */
function cardsPlusShortParagraphs(cards: number, paragraphs: number): PlanStoryPageData {
  return {
    title: "Your Plan",
    subtitle: "Proposed — Retire at 63",
    isEmpty: false,
    emptyMessage: "",
    chapters: [
      {
        chapterId: "whatWeRecommend",
        title: "What we're recommending, and why",
        layout: "strategyCards",
        paragraphs: Array.from(
          { length: paragraphs },
          (_, i) => `Strategy ${i + 1} — this changes what you're saving.`,
        ),
        strategies: Array.from({ length: cards }, (_, i) => ({
          name: `Strategy ${i + 1}`,
          what: "Annual amount",
          // NOT "" — `chapter-pdf.tsx` renders the "WHAT IT DOES" block only
          // when `detail` is non-empty, so an empty string silently ships a
          // shorter card than a real one and overstates how many paragraphs fit
          // beside it (measured: with `detail: ""` the sheet holds seven
          // paragraphs beside four cards, not three — a card missing its own
          // worst-case content, not the paragraph ceiling, was what changed).
          detail: "Claim age: 67 → 70",
        })),
        figures: [],
        steps: [],
        glossary: [],
        chart: null,
        overflowNote: "…and 7 more changes we'll walk through together.",
      },
    ],
  };
}

/** Options that print exactly the chapters a fixture holds. */
function optionsPrinting(data: PlanStoryPageData): PlanStoryOptions {
  const held = new Set(data.chapters.map((c) => c.chapterId));
  return {
    ...PLAN_STORY_OPTIONS_DEFAULT,
    scenarioId: "scn-1",
    sections: Object.fromEntries(
      CHAPTER_IDS.map((c) => [c, held.has(c)]),
    ) as PlanStoryOptions["sections"],
  };
}

/**
 * Options that print exactly ONE chapter, so a layout can be measured on its
 * own sheet.
 *
 * Built by switching every chapter OFF and the one under test on. The earlier
 * version named the three chapters that happened to be on by default, which
 * meant every task in Wave D silently added a second sheet to four layout
 * measurements and turned them red for a reason that had nothing to do with
 * layout.
 */
function onlyChapter(id: ChapterId): PlanStoryOptions {
  return {
    ...PLAN_STORY_OPTIONS_DEFAULT,
    scenarioId: "scn-1",
    sections: Object.fromEntries(
      CHAPTER_IDS.map((c) => [c, c === id]),
    ) as PlanStoryOptions["sections"],
  };
}

describe("Plan Story — real PDF render", () => {
  it("lays out one sheet per chapter, and no more", async () => {
    // Counted against the chapters this fixture actually holds, not against the
    // shipped default: the two agreed until a Wave D task switched a fifth
    // chapter on, and then this measurement went red for a reason that had
    // nothing to do with how anything lays out.
    expect(await pagesOf(REALISTIC)).toBe(
      estimatePlanStoryPageCount(undefined, optionsPrinting(REALISTIC)),
    );
  }, 30_000);

  /**
   * The measurement `view-model.ts`'s two constants were set from, re-run on
   * every suite. A comment claiming "we measured this" is worth nothing once
   * anything about the page changes — a font, a margin, the card's padding —
   * and the failure it hides is silent: the story still renders, and every page
   * number after it is wrong.
   *
   * Both worst cases the view-model can actually produce, at the budget exactly.
   */
  it.each([0, 1, 2, 3, MAX_STRATEGY_CARDS, MAX_STRATEGY_CARDS + 3])(
    "lays out one sheet per chapter with %i strategies and eight sheets of prose",
    async (cards) => {
      const data = atTheBound(cards);
      expect(await pagesOf(data)).toBe(data.chapters.length);
    },
    60_000,
  );

  // …and the other direction, so the two constants are pinned as a boundary
  // rather than as a floor a later edit could quietly raise.
  it("spills at one card past the cap, which is why the cap is where it is", async () => {
    expect(await pagesOf(worstCase(MAX_STRATEGY_CARDS + 1, 0))).toBe(2);
  }, 30_000);

  it("lays out a full card set beside the paragraph ceiling", async () => {
    expect(
      await pagesOf(cardsPlusShortParagraphs(MAX_STRATEGY_CARDS, MAX_PARAGRAPHS_WITH_CARDS)),
    ).toBe(1);
  }, 30_000);

  // …and the other direction, so the ceiling is pinned as a boundary rather than
  // as a floor a later edit could quietly raise. This is the case Wave F measured.
  it("spills at one paragraph past the ceiling, which is why the ceiling is where it is", async () => {
    expect(
      await pagesOf(cardsPlusShortParagraphs(MAX_STRATEGY_CARDS, MAX_PARAGRAPHS_WITH_CARDS + 1)),
    ).toBeGreaterThan(1);
  }, 30_000);

  /**
   * The other direction, and it cannot be "one paragraph over spills": the bound
   * is deliberately conservative, so it has headroom by construction. What has
   * to be pinned instead is that it is not conservative to the point of being
   * useless — a cap of one paragraph would satisfy every test above.
   *
   * So: a realistic chapter passes through with nothing dropped and no note.
   */
  it("does not trim a chapter of the length the narrators actually write", async () => {
    for (const chapter of REALISTIC.chapters) {
      expect(chapter.overflowNote).toBe("");
    }
    const data = buildPlanStoryData(
      {
        planStory: {
          story: {
            household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
            scenarioLabel: "Proposed",
            documentRole: "standalone",
            hasProposal: true,
            goals: [],
            strategies: [],
            facts: [],
          },
          text: Object.fromEntries(
            REALISTIC.chapters.map((c) => [c.chapterId, c.paragraphs.join("\n\n")]),
          ),
        },
        scenarioLabel: "Proposed",
      } as never,
      { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" },
    );
    for (const chapter of data.chapters) {
      expect(chapter.overflowNote).toBe("");
    }
    expect(await pagesOf(data)).toBe(data.chapters.length);
  }, 30_000);

  it("still fits with the overflow note printed under a full sheet", async () => {
    const note = "…and four more changes we'll walk through together.";
    const full = atTheBound(MAX_STRATEGY_CARDS);
    full.chapters = [full.chapters[full.chapters.length - 1]];
    full.chapters[0].overflowNote = note;
    const pdf = await renderToBuffer(
      <Document>{PlanStoryPagePdf({ data: full, ...FRAME })}</Document>,
    );
    // react-pdf writes the glyphs into an embedded subset, so the note is not
    // greppable in the output. One sheet with it, one sheet without it, and the
    // view-model suite owns the wording.
    expect(renderedPages(pdf)).toBe(1);
  }, 30_000);

  it("lays out the single sheet the empty state reserves", async () => {
    const empty: PlanStoryPageData = {
      title: "Your Plan",
      subtitle: "Base Case",
      isEmpty: true,
      emptyMessage: "The plan story isn't available for this report.",
      chapters: [],
    };
    expect(await pagesOf(empty)).toBe(1);
  }, 30_000);
});

/**
 * The twoUp layout's own bound, run rather than restated.
 *
 * Its prose column is ~two thirds the width a heroProse chapter's is, so the
 * heroProse budget would overflow it while every page-count check still read 1.
 * Measured on a bare `<Page>` — WITHOUT `PageFrame`'s `flex: 1` body, which
 * makes overflow clip instead of paginate — 210 words lay out and 220 spill;
 * `BUDGET_WORDS_TWO_UP` sits inside that. What is pinned here is the shipping
 * path: whatever the view model hands the renderer fits one sheet.
 */
function twoUpAtTheBound(figures: number): PlanStoryPageData {
  return buildPlanStoryData(
    {
      planStory: {
        story: {
          household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
          scenarioLabel: "Proposed",
          documentRole: "standalone",
          hasProposal: true,
          goals: [],
          strategies: [],
          facts: Array.from({ length: figures }, (_, i) => ({
            id: `spend.n${i}`,
            label: `What you could spend a year ${i + 1}`,
            display: "$260K",
            raw: 260_000,
            chapters: ["whatYouCanSpend" as const],
          })),
        },
        text: { whatYouCanSpend: LONG_PROSE },
      },
      scenarioLabel: "Proposed",
    } as never,
    onlyChapter("whatYouCanSpend"),
  );
}

describe("Plan Story — the twoUp layout, really rendered", () => {
  it.each([0, 1, MAX_FIGURE_CARDS, MAX_FIGURE_CARDS + 3])(
    "lays out one sheet with %i figures and eight sheets of prose",
    async (figures) => {
      const data = twoUpAtTheBound(figures);
      expect(data.chapters).toHaveLength(1);
      expect(data.chapters[0].layout).toBe("twoUp");
      expect(data.chapters[0].figures.length).toBeLessThanOrEqual(MAX_FIGURE_CARDS);
      expect(await pagesOf(data)).toBe(1);
    },
    60_000,
  );

  // …and the cap is not conservative to the point of being useless: a chapter of
  // the length a narrator actually writes passes through with nothing dropped.
  it("does not trim a twoUp chapter of the length the narrators write", async () => {
    const REAL =
      "You can spend about $260K a year without running short, against $210K on the path you're on today.\n\nThat comes from the two changes we walked through: waiting on Social Security, and moving money into the Roth while your bracket is low.\n\nIt isn't a number to spend to the penny. It's the ceiling the plan can carry, and there's room under it in the years you want less.";
    const data = buildPlanStoryData(
      {
        planStory: {
          story: {
            household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
            scenarioLabel: "Proposed",
            documentRole: "standalone",
            hasProposal: true,
            goals: [],
            strategies: [],
            facts: [],
          },
          text: { whatYouCanSpend: REAL },
        },
        scenarioLabel: "Proposed",
      } as never,
      onlyChapter("whatYouCanSpend"),
    );
    expect(data.chapters[0].overflowNote).toBe("");
    expect(data.chapters[0].paragraphs).toHaveLength(3);
    expect(await pagesOf(data)).toBe(1);
  }, 30_000);
});

/**
 * The checklist layout's bound, run rather than restated.
 *
 * The worst step a household can produce: text that wraps to two lines, with an
 * owner and a date under it. Measured on this path — eight such steps lay out
 * and ten do not; beside eight of them, 40 words of lead-in lay out and 45
 * spill. `MAX_STEPS` and `BUDGET_WORDS_CHECKLIST` sit inside both.
 */
const WORST_STEP = {
  text: "Open the Roth account with the custodian we discussed and fund it for this year before the filing deadline.",
  owner: "Cooper and Susan",
  when: "Before 15 April 2027",
};

function checklistAtTheBound(steps: number): PlanStoryPageData {
  return buildPlanStoryData(
    {
      planStory: {
        story: {
          household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
          scenarioLabel: "Proposed",
          documentRole: "standalone",
          hasProposal: true,
          goals: [],
          strategies: [],
          facts: [],
          nextSteps: Array.from({ length: steps }, () => WORST_STEP),
        },
        text: { whatHappensNext: LONG_PROSE },
      },
      scenarioLabel: "Proposed",
    } as never,
    onlyChapter("whatHappensNext"),
  );
}

describe("Plan Story — the checklist layout, really rendered", () => {
  it.each([0, 1, MAX_STEPS, MAX_STEPS + 4])(
    "lays out one sheet with %i next steps and eight sheets of prose",
    async (steps) => {
      const data = checklistAtTheBound(steps);
      expect(data.chapters).toHaveLength(1);
      expect(data.chapters[0].layout).toBe("checklist");
      expect(data.chapters[0].steps.length).toBeLessThanOrEqual(MAX_STEPS);
      expect(await pagesOf(data)).toBe(1);
    },
    60_000,
  );
});

/**
 * The glossary sheet, rendered from the REAL narrator rather than from a fixture.
 *
 * Chapter 13 is the one chapter whose length is not a household's — it is ours,
 * and it grows by roughly fifteen words every time a term joins `glossary.ts`.
 * So this runs the narrator itself: a fixture would go on passing after an edit
 * that overflowed the sheet, which is the whole thing worth watching here.
 */
const STORY_13 = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Proposed",
  documentRole: "standalone",
  hasProposal: true,
  goals: [],
  strategies: [],
  facts: [
    yearFact("plan.endOfLifeYear", "The last year we plan to", 2051),
    pctFact("plan.inflationRate", "Prices rise each year by", 0.025, ["thingsToKnow"]),
  ],
};

/**
 * The sheet at BOTH of its bounds at once, straight to the renderer with NO
 * view-model in between.
 *
 * ⚠️ Going through `buildPlanStoryData` cannot answer the layout question: it
 * caps the list at `MAX_GLOSSARY_TERMS` and trims the prose to
 * `BUDGET_WORDS_GLOSSARY` before the renderer ever sees either, so an overgrown
 * glossary comes back as one sheet plus a note — indistinguishable from one that
 * fit. Those caps are what the shipping-path case above proves; this is what
 * proves the caps are in the right place.
 *
 * The prose is spent in `MAX_PARAGRAPHS` short paragraphs rather than two long
 * ones because that is the worst shape the budget allows — a paragraph pays its
 * own bottom margin whether it holds four words or forty, and it is LINES this
 * sheet runs out of.
 */
function sheetAtTheBound(terms: number): PlanStoryPageData {
  const spare = Array.from({ length: Math.max(0, terms - GLOSSARY.length) }, (_, i) => ({
    term: `spare term ${i + 1}`,
    plain: "a definition written about as long as the longest one the glossary carries today.",
  }));
  const perParagraph = Math.ceil(BUDGET_WORDS_GLOSSARY / MAX_PARAGRAPHS);
  return {
    title: "Your Plan",
    subtitle: "Proposed",
    isEmpty: false,
    emptyMessage: "",
    chapters: [
      {
        chapterId: "thingsToKnow",
        title: "Things to know",
        layout: "glossary",
        paragraphs: Array.from({ length: MAX_PARAGRAPHS }, () =>
          "Your plan holds through the years we modelled and leaves room to spare for now."
            .split(/\s+/u)
            .slice(0, perParagraph)
            .join(" "),
        ),
        strategies: [],
        figures: [],
        steps: [],
        glossary: [...GLOSSARY, ...spare].slice(0, terms),
        chart: null,
        overflowNote: "…and three more terms we'll walk through together.",
      },
    ],
  };
}

describe("Plan Story — the glossary sheet, really rendered", () => {
  /** The shipping path: the real narrator, the real glossary, one sheet. */
  it("lays the whole glossary and the assumptions out on one sheet", async () => {
    const data = buildPlanStoryData(
      { planStory: { story: STORY_13, text: {} }, scenarioLabel: "Proposed" } as never,
      onlyChapter("thingsToKnow"),
    );
    expect(data.chapters[0].layout).toBe("glossary");
    expect(data.chapters[0].glossary).toHaveLength(GLOSSARY.length);
    expect(data.chapters[0].paragraphs).toHaveLength(3);
    expect(data.chapters[0].overflowNote).toBe("");
    expect(await pagesOf(data)).toBe(1);
  }, 30_000);

  // …and the same path with eight sheets of advisor prose pasted over it, which
  // is what a 20,000-character `editedText` buys. The glossary is not what gives
  // way; the prose is.
  it("lays out one sheet with the whole glossary and eight sheets of prose", async () => {
    const data = buildPlanStoryData(
      { planStory: { story: STORY_13, text: { thingsToKnow: LONG_PROSE } }, scenarioLabel: "Proposed" } as never,
      onlyChapter("thingsToKnow"),
    );
    expect(data.chapters[0].glossary).toHaveLength(GLOSSARY.length);
    expect(data.chapters[0].overflowNote).not.toBe("");
    expect(await pagesOf(data)).toBe(1);
  }, 30_000);

  it("lays out the full cap — every term the page will print, at the prose budget", async () => {
    expect(await pagesOf(sheetAtTheBound(MAX_GLOSSARY_TERMS))).toBe(1);
  }, 30_000);

  /**
   * THE RED for the case above. Without it a count of 1 could mean the layout is
   * incapable of paginating rather than that the content fits — `PageFrame` gives
   * its body `flex: 1`, and react-pdf clips past the available height on some
   * layouts instead of breaking.
   *
   * ONE term past the cap, so it also pins the cap where it is rather than
   * somewhere below it. `glossary.test.ts` keeps `glossary.ts` itself under the
   * same number, so the thirteenth term added goes red here rather than shipping
   * as a silent truncation.
   */
  it("spills at one term past the cap, which is why the cap is where it is", async () => {
    expect(await pagesOf(sheetAtTheBound(MAX_GLOSSARY_TERMS + 1))).toBeGreaterThan(1);
  }, 30_000);
});

/**
 * The chart sheets, through the real layout engine.
 *
 * The tree-walk tests in `plan-story.test.tsx` prove the chart is placed above
 * the prose and prints the right strings; only a render proves react-pdf can lay
 * its `Svg` out on a story sheet at all — an unhandled primitive or an
 * unregistered font throws here and nowhere else.
 *
 * ⚠️ NOT a fit check, and must not be read as one. `PageFrame` gives its body
 * `flex: 1`, so react-pdf may draw past the available height rather than
 * breaking: a count of 3 says these three sheets did not paginate, not that
 * their content stayed above the footer. That question is a different
 * instrument's, and `bodyBottom` below is it.
 */
const CHART_SHEETS: PlanStoryPageData = {
  title: "Your Plan",
  subtitle: "Proposed",
  isEmpty: false,
  emptyMessage: "",
  chapters: [
    {
      chapterId: "willTheMoneyLast",
      title: "Will the money last?",
      layout: "chartWithProse",
      paragraphs: ["The plan peaks at $3.1M in 2044 and still holds $1.8M in the last year we model."],
      strategies: [],
      figures: [],
      steps: [],
      glossary: [],
      chart: {
        kind: "portfolioBars",
        // A full horizon, so the widest chart on the deck is drawn at the story
        // sheet's 478pt rather than the summary page's 500.
        bars: Array.from({ length: 40 }, (_, i) => ({
          year: 2026 + i,
          cash: 120_000,
          taxable: 900_000 + i * 20_000,
          retirement: 1_400_000 + i * 30_000,
          total: 2_420_000 + i * 50_000,
        })),
        retirementYear: 2041,
      },
      overflowNote: "",
    },
    {
      chapterId: "whatYoullPayInTax",
      title: "What you'll pay in tax",
      layout: "chartWithProse",
      paragraphs: ["The heaviest year is 2044, at $96K."],
      strategies: [],
      figures: [],
      steps: [],
      glossary: [],
      chart: {
        kind: "taxBars",
        bars: Array.from({ length: 40 }, (_, i) => ({
          year: 2026 + i,
          federalOrdinary: 40_000 + i * 500,
          capGains: 8_000,
          state: 12_000,
          payroll: 0,
          total: 60_000 + i * 500,
        })),
      },
      overflowNote: "",
    },
    {
      chapterId: "whatsLeftForPeople",
      title: "What's left for the people you care about",
      layout: "chartWithProse",
      paragraphs: ["The whole estate comes to about $2.6M today, and $2.1M of it reaches the people you named."],
      strategies: [],
      figures: [],
      steps: [],
      glossary: [],
      chart: {
        // This is the PROPOSAL-DECK pairing: current plan against proposed
        // plan. The base deck draws a different pair from the same
        // component — Today vs End of Life — which `load-context.ts` builds
        // in the `todayVsEndOfLife` branch of its `estate` assignment, and
        // which `overTheYears()` in `whats-left-for-people.ts` now argues.
        kind: "estateBars",
        bars: [
          { label: "Current plan", netToHeirs: 2_100_000, federal: 0, state: 0, probate: 60_000, ird: 0, debts: 480_000, total: 2_640_000 },
          { label: "Proposed plan", netToHeirs: 3_400_000, federal: 220_000, state: 90_000, probate: 110_000, ird: 140_000, debts: 0, total: 3_960_000 },
        ],
        totals: ["$2.6M", "$4.0M"],
      },
      overflowNote: "",
    },
  ],
};

describe("Plan Story — the chart sheets, really rendered", () => {
  it("lays out one sheet per chart chapter", async () => {
    expect(await pagesOf(CHART_SHEETS)).toBe(CHART_SHEETS.chapters.length);
  }, 30_000);
});

/**
 * Where `PageFrame` stops letting content print: a 792pt Letter page less the
 * 72pt of `paddingBottom` that reserves the footer band (`shared/page-frame.tsx`
 * — the footer itself is absolutely positioned at `bottom: 42` and takes no
 * space in the flow, so that padding is the only thing holding content out of
 * it). A word whose foot sits below this line is printing over the disclaimer.
 */
const CONTENT_BOTTOM = 720;

/**
 * Every word in the rendered PDF, with the box it occupies, via
 * `pdftotext -bbox`. Requires poppler on PATH (`brew install poppler`) and says
 * so if it is missing — a measurement that quietly skips itself is worse than
 * one that is absent, because the suite goes on reporting green.
 */
function wordBoxes(pdf: Buffer): Array<{ key: string; yMax: number; yMin: number }> {
  const dir = mkdtempSync(join(tmpdir(), "plan-story-bbox-"));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    let xhtml: string;
    try {
      xhtml = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
    } catch (cause) {
      throw new Error(
        "this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }
    const out: Array<{ key: string; yMax: number; yMin: number }> = [];
    for (const line of xhtml.split("\n")) {
      const w = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">(.*)<\/word>/.exec(line);
      if (w) out.push({ key: `${w[5]}|${w[1]}|${w[2]}`, yMin: Number(w[2]), yMax: Number(w[4]) });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The words the FRAME itself prints inside the reserved band — the disclaimer
 * and the page-number row — keyed by glyph and position.
 *
 * Taken from a render of the same frame with a chart and no prose under it, so
 * they can be subtracted from a measured sheet by IDENTITY rather than by
 * height. A height rule would have to say "ignore everything below 720", and
 * everything below 720 is exactly what this measurement exists to find.
 */
let framePrints: Promise<Set<string>> | null = null;
function footerSlots(): Promise<Set<string>> {
  framePrints ??= (async () =>
    new Set(
      wordBoxes(
        await renderToBuffer(
          <Document>{PlanStoryPagePdf({ data: chartSheet([]), ...FRAME })}</Document>,
        ),
      )
        .filter((w) => w.yMin > CONTENT_BOTTOM)
        .map((w) => w.key),
    ))();
  return framePrints;
}

/**
 * How far down the sheet the chapter's own content reaches, and how many sheets
 * it took.
 *
 * ⚠️ `bottom` is NULL on any render but a one-sheet one, and that is deliberate
 * rather than lazy — it is not a number this instrument can produce. The
 * identity filter above learns the frame's footer words from a ONE-SHEET
 * calibration, where the row reads "Page 1 of 1". The moment the document
 * paginates that row reads "Page 1 of 2" and "Page 2 of 2": different glyphs,
 * and different x positions with them (measured: "Page" at 531.32 on the
 * calibration, 529.80 and 528.28 on the two sheets of a spilling render), so not
 * one of its eight words matches a learned key and the whole row survives the
 * filter on BOTH sheets. The maximum then comes back as 750 — the footer's own
 * baseline — on every spilling render alike, when page 1's last prose word is
 * near 698.
 *
 * Returning that number would be worse than returning nothing. Nothing here is
 * currently wrong in the client's direction, because contamination only ever
 * reads as "further down"; the hazard is the next person, who raises the budget,
 * sees the fit case go red, and asks this how far over it went. 750 is 30pt past
 * the disclaimer line and a budget re-derived from it would be too small — wrong
 * in the client's direction, from an instrument that looked precise.
 *
 * Filtering to page 1 does not rescue it: page 1's own footer is what changes.
 */
async function bodyBottom(data: PlanStoryPageData): Promise<{ bottom: number | null; sheets: number }> {
  const frame = await footerSlots();
  const pdf = await renderToBuffer(<Document>{PlanStoryPagePdf({ data, ...FRAME })}</Document>);
  const sheets = renderedPages(pdf);
  if (sheets !== 1) return { bottom: null, sheets };
  const body = wordBoxes(pdf).filter((w) => !frame.has(w.key));
  // Nothing but the frame came back, so there is no geometry to compare and
  // `Math.max` would hand back -Infinity — which reads as "fits" and passes.
  if (body.length === 0) throw new Error("no chapter content in the rendered sheet");
  return { bottom: Math.max(...body.map((w) => w.yMax)), sheets };
}

/**
 * Both ways a sheet can fail to hold its prose, each read by the instrument that
 * can actually see it.
 *
 * Every overflow measured on this layout broke to a second sheet, and the page
 * tree is what says so. `PageFrame`'s `flex: 1` body is why that alone cannot be
 * trusted — a sheet that clipped instead of breaking still counts 1 — so the
 * geometry answers for the one-sheet case, which per `bodyBottom` is the only
 * case it HAS an answer for.
 */
function spilled({ bottom, sheets }: { bottom: number | null; sheets: number }): boolean {
  if (sheets !== 1) return true;
  return bottom !== null && bottom > CONTENT_BOTTOM;
}

/** …and the geometry on its own, for the case that has one. Throws rather than
 *  returning null so a paginated render cannot reach a comparison as
 *  `null <= 720`, which passes. */
async function oneSheetBottom(data: PlanStoryPageData): Promise<number> {
  const { bottom, sheets } = await bodyBottom(data);
  if (bottom === null) throw new Error(`expected one sheet, rendered ${sheets}`);
  return bottom;
}

/** The measuring stick the sheet budgets above are cut against, one paragraph's
 *  worth at a time. A line of this sheet's prose holds 15 of these words, so a
 *  paragraph of 16 pays for two lines and wastes most of the second. */
const STICK =
  "Your plan holds through the years we modelled and leaves room to spare for the things you told us matter most to you now and later on.".split(
    /\s+/u,
  );
const WASTEFUL_PARAGRAPH = 16;

/**
 * The most expensive way to spend `words` across `paragraphs` — every paragraph
 * but the last runs one word past a line break and pays for a line it barely
 * uses, and the remainder piles into the last one.
 *
 * This is a shape the view model really emits: `capParagraphs` bounds the word
 * count and the paragraph count independently, so an advisor edit of several
 * one-line asides followed by a long closing paragraph arrives exactly like
 * this.
 */
function wastefulProse(words: number, paragraphs: number): string[] {
  const paragraph = (n: number) =>
    Array.from({ length: n }, (_, i) => STICK[i % STICK.length]).join(" ") + ".";
  const spent = WASTEFUL_PARAGRAPH * (paragraphs - 1);
  return [...Array.from({ length: paragraphs - 1 }, () => paragraph(WASTEFUL_PARAGRAPH)), paragraph(words - spent)];
}

/** One `chartWithProse` sheet carrying the tallest chart of the three — the
 *  portfolio chart, 150pt of `Svg` over a legend row, which the tax chart
 *  matches to the point and the estate chart sits 62pt inside — and the trim
 *  note, which is what prints whenever the budget under it actually binds. */
function chartSheet(paragraphs: string[]): PlanStoryPageData {
  return {
    title: "Your Plan",
    subtitle: "Proposed",
    isEmpty: false,
    emptyMessage: "",
    chapters: [
      {
        chapterId: "willTheMoneyLast",
        title: "Will the money last?",
        layout: "chartWithProse",
        paragraphs,
        strategies: [],
        figures: [],
        steps: [],
        glossary: [],
        chart: CHART_SHEETS.chapters[0].chart,
        overflowNote: "…there's more here than fits this page — we'll walk through the rest together.",
      },
    ],
  };
}

/**
 * The same worst case on the ESTATE chapter's own chart.
 *
 * `BUDGET_WORDS_CHART` is one number for all three layouts and was measured on
 * the tall pair, so the estate sheet fits *by argument* — its chart is 88pt of
 * `Svg` where theirs is 150. This renders it instead, because the argument is
 * only as good as the two numbers it rests on, and this sheet is the one a
 * client actually receives.
 *
 * Its legend is also the widest of the three — six segments against the tax
 * chart's four — and a legend that wrapped to a second row would eat height no
 * arithmetic about the `Svg` alone would predict.
 */
function estateChartSheet(paragraphs: string[]): PlanStoryPageData {
  return {
    title: "Your Plan",
    subtitle: "Proposed",
    isEmpty: false,
    emptyMessage: "",
    chapters: [
      {
        ...CHART_SHEETS.chapters[2],
        paragraphs,
        overflowNote: "…there's more here than fits this page — we'll walk through the rest together.",
      },
    ],
  };
}

/**
 * The measurement `BUDGET_WORDS_CHART` and `MAX_PARAGRAPHS_CHART` were set from,
 * re-run every suite.
 *
 * ⚠️ These read the rendered GEOMETRY, not a page count and not a word count.
 * A page count cannot see a sheet that clipped rather than paginated, and an
 * assertion that the view model's trimmed prose respects the view model's own
 * budget is a constant compared with itself — it can never fail, whatever the
 * sheet does.
 */
describe("Plan Story — what a chart sheet's prose may spend", () => {
  it("keeps the worst prose the budget allows above the footer", async () => {
    const bottom = await oneSheetBottom(
      chartSheet(wastefulProse(BUDGET_WORDS_CHART, MAX_PARAGRAPHS_CHART)),
    );
    expect(bottom).toBeLessThanOrEqual(CONTENT_BOTTOM);
  }, 60_000);

  // …and the other direction on each bound separately, so neither is pinned as
  // a floor a later edit could quietly raise. Both numbers are the measured
  // ones: at five paragraphs 195 words lay out and 200 do not; at 150 words six
  // paragraphs lay out and seven do not.
  it("spills at 200 words, which is why the word budget is where it is", async () => {
    const measured = await bodyBottom(chartSheet(wastefulProse(200, 5)));
    expect(spilled(measured), `measured ${JSON.stringify(measured)}`).toBe(true);
  }, 60_000);

  it("spills at seven paragraphs, which is why the paragraph cap is where it is", async () => {
    const measured = await bodyBottom(chartSheet(wastefulProse(150, 7)));
    expect(spilled(measured), `measured ${JSON.stringify(measured)}`).toBe(true);
  }, 60_000);

  // The estate chapter shares the budget above rather than getting its own, so
  // the only question left for it is whether the shared number actually holds on
  // its sheet. Measured, not argued from the 62pt of chart height it saves.
  it("keeps the estate chapter's worst prose above the footer on its own chart", async () => {
    const bottom = await oneSheetBottom(
      estateChartSheet(wastefulProse(BUDGET_WORDS_CHART, MAX_PARAGRAPHS_CHART)),
    );
    expect(bottom).toBeLessThanOrEqual(CONTENT_BOTTOM);
  }, 60_000);
});
