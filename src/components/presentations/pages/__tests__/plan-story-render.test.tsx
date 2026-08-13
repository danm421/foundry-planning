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
import {
  buildPlanStoryData,
  MAX_STRATEGY_CARDS,
  type PlanStoryPageData,
} from "@/lib/presentations/pages/plan-story/view-model";

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

describe("Plan Story — real PDF render", () => {
  it("lays out one sheet per chapter, and no more", async () => {
    const proposed: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };
    expect(await pagesOf(REALISTIC)).toBe(estimatePlanStoryPageCount(undefined, proposed));
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
