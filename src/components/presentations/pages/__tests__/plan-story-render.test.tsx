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
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { estimatePlanStoryPageCount } from "@/lib/presentations/pages/plan-story/estimate-page-count";
import { PLAN_STORY_OPTIONS_DEFAULT, type PlanStoryOptions } from "@/lib/presentations/pages/plan-story/options-schema";
import { CHAPTER_IDS, type ChapterId } from "@/lib/presentations/story/types";
import {
  buildPlanStoryData,
  BUDGET_WORDS_GLOSSARY,
  MAX_FIGURE_CARDS,
  MAX_GLOSSARY_TERMS,
  MAX_PARAGRAPHS,
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
            id: `outcome.n${i}`,
            label: `Confidence, proposed plan ${i + 1}`,
            display: "96.3%",
            raw: 0.963,
            chapters: ["willTheMoneyLast" as const],
          })),
        },
        text: { willTheMoneyLast: LONG_PROSE },
      },
      scenarioLabel: "Proposed",
    } as never,
    onlyChapter("willTheMoneyLast"),
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
      "Your plan holds up in almost every run we tested — 96.3% of them, against 84% on the path you're on today.\n\nThat comes from the two changes we walked through: waiting on Social Security, and moving money into the Roth while your bracket is low.\n\nThe years that go wrong are the ones where the market falls early. Even then, you don't run out — you spend a little less in your eighties.";
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
          text: { willTheMoneyLast: REAL },
        },
        scenarioLabel: "Proposed",
      } as never,
      onlyChapter("willTheMoneyLast"),
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
