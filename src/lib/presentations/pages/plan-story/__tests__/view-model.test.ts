import { describe, it, expect, vi } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import type { Fact } from "@/lib/presentations/story/facts";
import { GLOSSARY } from "@/lib/presentations/story/glossary";
import { CHAPTER_IDS, type ChapterId, type StoryContext } from "@/lib/presentations/story/types";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";

/** What the shipped default prints with no scenario picked: every chapter, less
 *  the ones with nothing to recommend. Derived from the registry, so a fifteenth
 *  chapter joins it by existing; the hand-written copy of the default's own list
 *  — the one that has to change deliberately — lives in `options.test.ts`, which
 *  is where the shipped default is actually pinned. */
const DEFAULT_PRINTED = CHAPTER_IDS.filter((id) => !CHAPTERS[id].requiresProposal);
import {
  buildPlanStoryData,
  BUDGET_WORDS_GLOSSARY,
  MAX_FIGURE_CARDS,
  MAX_GLOSSARY_TERMS,
  MAX_PARAGRAPHS_WITH_CARDS,
  MAX_STEPS,
  MAX_STRATEGY_CARDS,
  SHEET_BUDGET_WORDS,
  type PlanStoryChapterView,
  type PlanStoryContextInput,
  type PlanStoryPageData,
} from "../view-model";
import {
  PLAN_STORY_OPTIONS_DEFAULT,
  applyPreset,
  planStoryHasProposal,
  type PlanStoryOptions,
} from "../options-schema";
import { estimatePlanStoryPageCount } from "../estimate-page-count";

/**
 * `buildPlanStoryData` reads exactly two fields off the deck context —
 * `planStory` and `scenarioLabel`. A full `BuildDataContext` needs a projection,
 * a client tree and a dozen branding fields, none of which this builder can
 * reach, so the fixture supplies the two and casts. If the builder ever starts
 * reading a third field this cast turns it into `undefined` at runtime, which
 * fails loudly rather than passing silently.
 */
function deckCtx(planStory: PlanStoryContextInput | undefined, scenarioLabel = "Base Case"): BuildDataContext {
  return { planStory, scenarioLabel } as unknown as BuildDataContext;
}

function story(over: Partial<StoryContext> = {}): StoryContext {
  return {
    household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
    scenarioLabel: "Base Case",
    documentRole: "standalone",
    hasProposal: false,
    strategies: [],
    goals: [],
    facts: [],
    ...over,
  };
}

function input(
  over: Partial<StoryContext> = {},
  text: Partial<Record<ChapterId, string>> = {},
): PlanStoryContextInput {
  return { story: story(over), text };
}

function money(id: string, display: string, raw: number, chapters?: ChapterId[]): Fact {
  return { id, label: id, display, raw, ...(chapters ? { chapters } : {}) };
}

function row(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    area: "Income",
    what: "Alan's Social Security",
    op: "edit",
    before: "67",
    after: "70",
    // More than one segment on purpose: the card quotes the FIRST, so a mutant
    // that joined them would otherwise be invisible.
    detail: ["Claim age: 67 to 70", "Adds $40K of lifetime benefit"],
    ...over,
  };
}

const PROPOSED: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };

/** Every chapter of the arc switched off — the advisor-turned-it-all-off case. */
function allSectionsOff(): PlanStoryOptions["sections"] {
  return Object.fromEntries(
    CHAPTER_IDS.map((id) => [id, false]),
  ) as PlanStoryOptions["sections"];
}

function chapterIds(data: PlanStoryPageData): ChapterId[] {
  return data.chapters.map((c) => c.chapterId);
}

function paragraphsOf(data: PlanStoryPageData, id: ChapterId): string[] {
  return data.chapters.find((c) => c.chapterId === id)?.paragraphs ?? [];
}

/**
 * The number of physical PDF pages the Task 14 renderer produces for this data:
 * one PageFrame per chapter, or a single empty-state page. The estimate
 * `document.tsx` numbers the whole deck by has to equal this, or every page
 * after the story carries the wrong number.
 */
function physicalPages(data: PlanStoryPageData): number {
  return data.isEmpty ? 1 : data.chapters.length;
}

describe("buildPlanStoryData — nothing to print", () => {
  it("reports an absent story rather than pretending the chapters were switched off", () => {
    const data = buildPlanStoryData(deckCtx(undefined), PROPOSED);
    expect(data.isEmpty).toBe(true);
    expect(data.chapters).toEqual([]);
    expect(data.emptyMessage).toBe("The plan story isn't available for this report.");
  });

  it("says the chapters are switched off when that is what happened", () => {
    const allOff: PlanStoryOptions = {
      ...PROPOSED,
      sections: allSectionsOff(),
    };
    const data = buildPlanStoryData(deckCtx(input()), allOff);
    expect(data.isEmpty).toBe(true);
    expect(data.chapters).toEqual([]);
    expect(data.emptyMessage).toBe("No chapters are switched on for this report.");
  });

  it("carries no empty-state message when there is something to print", () => {
    const data = buildPlanStoryData(deckCtx(input()), PLAN_STORY_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(false);
    expect(data.emptyMessage).toBe("");
  });
});

describe("buildPlanStoryData — which chapters render", () => {
  it("drops the recommendation chapter on a base-only story", () => {
    const data = buildPlanStoryData(deckCtx(input()), PLAN_STORY_OPTIONS_DEFAULT);
    expect(chapterIds(data)).toEqual(DEFAULT_PRINTED);
  });

  it("keeps it once a scenario is picked", () => {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true })), PROPOSED);
    expect(chapterIds(data)).toEqual(CHAPTER_IDS);
  });

  it("decides from the options alone, not from the loaded story's own flag", () => {
    // The two agree in production because the export loader derives the story's
    // `hasProposal` from this same `scenarioId`. The builder must still key off
    // the options: `estimatePlanStoryPageCount` has no story to consult, so the
    // moment the builder consults one they can disagree about how many pages
    // this page occupies — which is the defect this whole rule exists to close.
    const optimistic = buildPlanStoryData(deckCtx(input({ hasProposal: false })), PROPOSED);
    expect(chapterIds(optimistic)).toEqual(CHAPTER_IDS);
    expect(paragraphsOf(optimistic, "whatWeRecommend")).toEqual([
      "We aren't suggesting changes to the plan this time.",
    ]);

    const pessimistic = buildPlanStoryData(
      deckCtx(input({ hasProposal: true })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(chapterIds(pessimistic)).toEqual(DEFAULT_PRINTED);
  });

  it("carries the registry's title and layout onto each chapter", () => {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true })), PROPOSED);
    // Read off the registry: what this pins is that the builder CARRIES them,
    // not what any one chapter happens to be titled this week.
    expect(data.chapters.map((c) => c.title)).toEqual(
      CHAPTER_IDS.map((id) => CHAPTERS[id].title),
    );
    expect(data.chapters.map((c) => c.layout)).toEqual(
      CHAPTER_IDS.map((id) => CHAPTERS[id].layout),
    );
    expect(new Set(data.chapters.map((c) => c.layout)).size).toBeGreaterThan(1);
  });
});

describe("buildPlanStoryData — where the prose comes from", () => {
  it("prints the advisor's stored text in preference to the narrator", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ facts: [money("today.assets", "$2M", 2_000_000)] }, { whatYouHave: "Advisor wrote this." })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "whatYouHave")).toEqual(["Advisor wrote this."]);
  });

  it("falls back to the narrator when the stored text is only whitespace", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ facts: [money("today.assets", "$2M", 2_000_000)] }, { whatYouHave: "   \n\t  " })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "whatYouHave")[0]).toBe("You own $2M.");
  });

  it("falls back to the narrator when nothing was ever generated", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ facts: [money("today.debts", "$300K", 300_000)] })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "whatYouHave")).toEqual(["You owe $300K."]);
  });

  /**
   * The RENDER half of the page-count contract, whose other half lives in
   * `options.test.ts` ("keeps a coverage chapter's sheet even when it has
   * nothing in it").
   *
   * That test proves the sheet is still reserved for a household with no
   * policies on file. This one proves what lands on it: a chapter reserved and
   * then rendered blank is the same defect as one that mis-numbers the deck, and
   * only the narrator can tell the client why the page is short. `available` is
   * a GENERATE-time filter — it saves a model call, never a page.
   */
  it("prints a coverage chapter's honest empty state on its reserved sheet", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ facts: [money("today.assets", "$2M", 2_000_000)] })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    const paragraphs = paragraphsOf(data, "protectingYourFamily");
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs.join(" ")).toMatch(/don't have|no policies|nothing recorded/iu);
  });

  it("splits stored text into paragraphs on blank lines, trimming each", () => {
    const stored = "First para.\n\n\n  Second para.  \n\nThird para.\n\n";
    const data = buildPlanStoryData(
      deckCtx(input({}, { planInOnePage: stored })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "planInOnePage")).toEqual([
      "First para.",
      "Second para.",
      "Third para.",
    ]);
  });

  it("keeps a single-newline break inside one paragraph", () => {
    const data = buildPlanStoryData(
      deckCtx(input({}, { planInOnePage: "One line.\nStill the same paragraph." })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "planInOnePage")).toEqual(["One line.\nStill the same paragraph."]);
  });

  /**
   * The system prompt asks for "clean Markdown" and the renderer draws raw
   * `<Text>`, so `##`, `**` and a table's pipes print literally on a client's
   * page. No gate catches it — Gate 2 rejects only a NESTED heading — and the
   * advisor's own `editedText` is never gated at all. Stripping here covers both,
   * because both arrive as this same resolved string.
   */
  it("strips heading and emphasis syntax the PDF would otherwise print literally", () => {
    const stored = "## What your plan shows\n\nYou hold **$2.1M** today, and _that_ is the whole story.";
    const data = buildPlanStoryData(
      deckCtx(input({}, { planInOnePage: stored })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "planInOnePage")).toEqual([
      "What your plan shows",
      "You hold $2.1M today, and that is the whole story.",
    ]);
  });

  it("flattens a markdown table rather than printing its pipes", () => {
    const stored = "Here is the shape of it.\n\n| Figure | Value |\n| --- | --- |\n| Liquid | $2.1M |";
    const data = buildPlanStoryData(
      deckCtx(input({}, { planInOnePage: stored })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "planInOnePage")).toEqual([
      "Here is the shape of it.",
      "Figure · Value\nLiquid · $2.1M",
    ]);
  });

  it("leaves ordinary prose, dashes and figures exactly as the advisor wrote them", () => {
    // The other side of the same rule: an em-dash, a hyphenated word and a
    // figure are what this document is made of, and none of them is syntax.
    const stored = "You own $2.1M — 73% of the futures work.\nA dash-joined word survives.";
    const data = buildPlanStoryData(
      deckCtx(input({}, { planInOnePage: stored })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(paragraphsOf(data, "planInOnePage")).toEqual([stored]);
  });

  it("shows each chapter only the figures scoped to it", () => {
    // `today.netWorth` belongs to "What you have" alone. Unscoped, the punchline
    // chapter's narrator would print "You're starting from $1.2M." — a figure
    // this chapter was never licensed to use, and one the review panel's own
    // copy of the same narrator would not show.
    const facts = [money("today.netWorth", "$1.2M", 1_200_000, ["whatYouHave"])];
    const data = buildPlanStoryData(deckCtx(input({ facts })), PLAN_STORY_OPTIONS_DEFAULT);

    expect(paragraphsOf(data, "planInOnePage").join(" ")).not.toContain("$1.2M");
    expect(paragraphsOf(data, "planInOnePage")).toEqual([
      "Here's where your plan stands today, and what it looks like from here.",
    ]);
    expect(paragraphsOf(data, "whatYouHave").join(" ")).toContain("$1.2M");
  });
});

describe("buildPlanStoryData — strategy cards", () => {
  const strategies = [
    {
      name: "Delay Social Security",
      rows: [
        row(),
        row({ what: "Teresa's Social Security", detail: ["Claim age: 65 to 70"] }),
      ],
    },
  ];

  /** The figure inside the card fixture's detail, admitted to the pack in the
   *  changes table's own spelling — what `build-facts.ts` does for real. */
  const quoted = (display: string): Fact => ({
    id: `quoted.${display}`,
    label: "quoted",
    display,
    raw: null,
  });

  it("names the strategy, joins what every row touches, and quotes the first detail", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, strategies })),
      PROPOSED,
    );
    const cards = data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies;
    expect(cards).toEqual([
      {
        name: "Delay Social Security",
        what: "Alan's Social Security, Teresa's Social Security",
        detail: "Claim age: 67 to 70",
      },
    ]);
  });

  it("leaves the detail empty when the first row carries no segments", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, strategies: [{ name: "Trim spending", rows: [row({ detail: [] })] }] })),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe("");
  });

  it("prints a figure the fact pack holds, in the pack's own spelling", () => {
    const data = buildPlanStoryData(
      deckCtx(
        input({
          hasProposal: true,
          facts: [quoted("$50K")],
          strategies: [{ name: "Convert to Roth", rows: [row({ detail: ["Converts $50K a year"] })] }],
        }),
      ),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe(
      "Converts $50K a year",
    );
  });

  it("drops a figure the fact pack does not hold, rather than borrowing it", () => {
    // `detail` is written by the Scenario Changes table, in its rounding and its
    // case. The whole report rests on every figure a client reads being one we
    // put there deliberately, so an ungrounded clause leaves the card silent.
    const data = buildPlanStoryData(
      deckCtx(
        input({
          hasProposal: true,
          facts: [],
          strategies: [{ name: "Convert to Roth", rows: [row({ detail: ["Converts $50K a year"] })] }],
        }),
      ),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe("");
  });

  it("drops a figure whose VALUE is grounded but whose spelling is the other module's", () => {
    // "$50k" and "$50K" are one value in two spellings. Printing the table's
    // would put both spellings of the same dollar in one deck.
    const data = buildPlanStoryData(
      deckCtx(
        input({
          hasProposal: true,
          facts: [quoted("$50K")],
          strategies: [{ name: "Convert to Roth", rows: [row({ detail: ["Converts $50k a year"] })] }],
        }),
      ),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe("");
  });

  it("grounds the card against this chapter's figures, not the whole pack", () => {
    // `today.netWorth` belongs to "What you have". Grounded against the whole
    // pack, a card could quote it — a balance-sheet total presented as what a
    // recommendation frees up, which is exactly what fact scoping exists to stop.
    const data = buildPlanStoryData(
      deckCtx(
        input({
          hasProposal: true,
          facts: [money("today.netWorth", "$1.2M", 1_200_000, ["whatYouHave"])],
          strategies: [{ name: "Sell the rental", rows: [row({ detail: ["Frees up $1.2M"] })] }],
        }),
      ),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe("");
  });

  it("drops an accounting-paren negative, which grounding alone cannot catch", () => {
    const data = buildPlanStoryData(
      deckCtx(
        input({
          hasProposal: true,
          facts: [quoted("$50K"), quoted("$20K")],
          strategies: [{ name: "Trim savings", rows: [row({ detail: ["Annual amount: ($50K) → ($20K)"] })] }],
        }),
      ),
      PROPOSED,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.strategies[0].detail).toBe("");
  });

  it("gives a prose chapter no cards, however many strategies the plan has", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, strategies })),
      PROPOSED,
    );
    for (const chapter of data.chapters.filter((c) => c.layout === "heroProse")) {
      expect(chapter.strategies).toEqual([]);
    }
  });
});

describe("buildPlanStoryData — the subtitle names the plan the prose is about", () => {
  it("takes the story's scenario, not the deck's per-page override", () => {
    // The deck override drives `ctx.scenarioLabel`; `options.scenarioId` drives
    // the prose. Point the override at the proposal while leaving the story on
    // base and the page would be headed "Proposed" over Base Case prose.
    const data = buildPlanStoryData(deckCtx(input(), "Proposed"), PLAN_STORY_OPTIONS_DEFAULT);
    expect(data.subtitle).toBe("Base Case");
  });

  it("falls back to the deck's label when there is no story to contradict it", () => {
    const data = buildPlanStoryData(deckCtx(undefined, "Proposed"), PLAN_STORY_OPTIONS_DEFAULT);
    expect(data.subtitle).toBe("Proposed");
  });
});

describe("the estimate and the render agree", () => {
  // Three chapters toggled through every combination, over a deck that is
  // otherwise at its shipped default — which is now all fourteen ON, so each
  // case is the full arc with three keys moved rather than three chapters over
  // an empty deck. That is the harder case for the estimate, not the easier one:
  // every chapter it does not toggle still has to be counted and rendered.
  const SECTION_SETS = [false, true].flatMap((planInOnePage) =>
    [false, true].flatMap((whatYouHave) =>
      [false, true].map((whatWeRecommend) => ({
        ...PLAN_STORY_OPTIONS_DEFAULT.sections,
        planInOnePage,
        whatYouHave,
        whatWeRecommend,
      })),
    ),
  );
  const PRESET_IDS = ["full", "brief", "custom"] as const;
  const SCENARIO_IDS = ["", "base", "scn-1"];

  it("matches physical pages to the estimate across every preset × sections × scenario", () => {
    let checked = 0;
    for (const preset of PRESET_IDS) {
      for (const sections of SECTION_SETS) {
        for (const scenarioId of SCENARIO_IDS) {
          const options: PlanStoryOptions = {
            preset,
            documentRole: "standalone",
            scenarioId,
            sections,
          };
          // The export loader derives both from the same rule, so the fixture
          // does too — anything else would test a state production cannot reach.
          const ctx = deckCtx(input({ hasProposal: planStoryHasProposal(options) }));
          const data = buildPlanStoryData(ctx, options);
          expect(
            physicalPages(data),
            `preset=${preset} scenario="${scenarioId}" sections=${JSON.stringify(sections)}`,
          ).toBe(estimatePlanStoryPageCount(undefined as never, options));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(72);
  });

  it("matches for both presets as the options control applies them", () => {
    // Every chapter of the arc, with stored text — which is what the export
    // loader supplies for a generated deck, and what keeps this case about the
    // ESTIMATE rather than about what any one narrator happens to write.
    const stored = Object.fromEntries(
      CHAPTER_IDS.map((id) => [id, "One stored paragraph, as the export loader supplies it."]),
    );
    for (const preset of ["full", "brief"] as const) {
      for (const scenarioId of SCENARIO_IDS) {
        const options = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId }, preset);
        const ctx = deckCtx(input({ hasProposal: planStoryHasProposal(options) }, stored));
        expect(physicalPages(buildPlanStoryData(ctx, options))).toBe(
          estimatePlanStoryPageCount(undefined as never, options),
        );
      }
    }
  });

  it("KNOWN GAP: an absent story renders one page where the estimate reserved more", () => {
    // Not fixable from options alone — whether the story loaded is not something
    // `document.tsx` can see when it numbers the deck. Task 16's export loader
    // supplies `planStory` for every deck containing this page, so this branch is
    // defensive; it is pinned so the gap stays named rather than discovered.
    const data = buildPlanStoryData(deckCtx(undefined), PROPOSED);
    expect(physicalPages(data)).toBe(1);
    expect(estimatePlanStoryPageCount(undefined as never, PROPOSED)).toBe(CHAPTER_IDS.length);
  });
});

/**
 * `physicalPages` above counts one sheet per chapter, and `estimatePlanStoryPageCount`
 * reserves on the same rule from the options ALONE — `document.tsx` calls it with
 * no data. So the invariant those tests assert is only true if a chapter cannot
 * render onto a second sheet. Nothing made that true; these do.
 */
describe("one sheet per chapter, by construction", () => {
  function withStrategies(n: number, text: Partial<Record<ChapterId, string>> = {}): PlanStoryPageData {
    return buildPlanStoryData(
      deckCtx(
        input(
          {
            hasProposal: true,
            strategies: Array.from({ length: n }, (_, i) => ({
              name: `Strategy ${i + 1}`,
              rows: [row({ what: `Change ${i + 1}`, detail: [] })],
            })),
          },
          text,
        ),
      ),
      PROPOSED,
    );
  }

  const recommend = (data: PlanStoryPageData) =>
    data.chapters.find((c) => c.chapterId === "whatWeRecommend")!;

  it("prints every card when they fit", () => {
    const chapter = recommend(withStrategies(MAX_STRATEGY_CARDS));
    expect(chapter.strategies).toHaveLength(MAX_STRATEGY_CARDS);
    // The cards all fit, but the prose does not fit for free alongside them: the
    // AI-off narrator writes one paragraph per strategy, and four of those beside
    // a full card set is exactly the shape `MAX_PARAGRAPHS_WITH_CARDS` caps — the
    // note says so rather than silently dropping the fourth.
    expect(chapter.overflowNote).not.toBe("");
  });

  it("caps the cards at the sheet's capacity", () => {
    expect(recommend(withStrategies(11)).strategies).toHaveLength(MAX_STRATEGY_CARDS);
  });

  it("says how many it did not print, in the client's language", () => {
    expect(recommend(withStrategies(11)).overflowNote).toBe(
      `…and ${11 - MAX_STRATEGY_CARDS} more changes we'll walk through together.`,
    );
  });

  it("says 'one more change' rather than '1 more changes'", () => {
    expect(recommend(withStrategies(MAX_STRATEGY_CARDS + 1)).overflowNote).toBe(
      "…and one more change we'll walk through together.",
    );
  });

  // `editedText` accepts 20,000 characters — roughly 3,000 words, or eight
  // sheets — and no gate ever sees an advisor's own writing. Without this bound
  // one pasted note drifts the contents exactly as eleven cards do.
  it("bounds the paragraphs too, so a 20,000-character edit cannot overflow", () => {
    const long = Array.from({ length: 40 }, () => "word ".repeat(50).trim()).join("\n\n");
    const chapter = buildPlanStoryData(
      deckCtx(input({}, { whatYouHave: long })),
      PLAN_STORY_OPTIONS_DEFAULT,
    ).chapters.find((c) => c.chapterId === "whatYouHave")!;
    const words = chapter.paragraphs.join(" ").split(/\s+/u).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(SHEET_BUDGET_WORDS);
    expect(chapter.overflowNote).not.toBe("");
  });

  // A chapter with nothing on it is the one outcome the renderer is built to
  // make impossible. A lone over-budget paragraph is therefore CUT rather than
  // dropped — keeping it whole, which is the obvious alternative, would break
  // the very invariant this cap exists to establish.
  it("cuts a lone over-long paragraph rather than blanking the chapter or spilling", () => {
    const chapter = buildPlanStoryData(
      deckCtx(input({}, { whatYouHave: "word ".repeat(SHEET_BUDGET_WORDS * 2).trim() })),
      PLAN_STORY_OPTIONS_DEFAULT,
    ).chapters.find((c) => c.chapterId === "whatYouHave")!;
    expect(chapter.paragraphs).toHaveLength(1);
    expect(chapter.paragraphs[0].split(/\s+/u).filter(Boolean).length).toBeLessThanOrEqual(
      SHEET_BUDGET_WORDS,
    );
    expect(chapter.overflowNote).not.toBe("");
  });

  // …and it cuts at a sentence end, not mid-thought, whenever one fits.
  it("cuts a long paragraph at a sentence boundary", () => {
    const sentence = "Your plan holds through every year we modelled and leaves room to spare. ";
    const chapter = buildPlanStoryData(
      deckCtx(input({}, { whatYouHave: sentence.repeat(60).trim() })),
      PLAN_STORY_OPTIONS_DEFAULT,
    ).chapters.find((c) => c.chapterId === "whatYouHave")!;
    expect(chapter.paragraphs[0].endsWith(".")).toBe(true);
  });

  // The cards are charged against the same sheet the prose is, so a chapter
  // carrying both gets LESS prose room than one carrying none. Independent caps
  // satisfy both limits and still spill — the measured grid says so.
  it("charges the cards against the prose budget", () => {
    const lead = "word ".repeat(SHEET_BUDGET_WORDS).trim();
    const chapter = recommend(withStrategies(MAX_STRATEGY_CARDS, { whatWeRecommend: lead }));
    const words = chapter.paragraphs.join(" ").split(/\s+/u).filter(Boolean).length;
    expect(chapter.strategies).toHaveLength(MAX_STRATEGY_CARDS);
    // A chapter with no cards may spend the whole sheet; one carrying the full
    // set of cards may not, and independent caps could never see the difference.
    // A chapter with no cards may spend the whole sheet; one carrying the full
    // set may not, and independent caps could never see the difference.
    expect(words).toBeLessThan(SHEET_BUDGET_WORDS);
  });

  // Both bounds can bite at once, and two notes on one sheet is the overflow
  // this whole task exists to prevent.
  it("prints one note even when both bounds bite", () => {
    const long = Array.from({ length: 40 }, () => "word ".repeat(50).trim()).join("\n\n");
    const note = recommend(withStrategies(11, { whatWeRecommend: long })).overflowNote;
    expect(note).toBe(`…and ${11 - MAX_STRATEGY_CARDS} more changes we'll walk through together.`);
    expect(note.split("…and")).toHaveLength(2);
  });

  it("caps the AI-off recommendation narrative at the paragraph ceiling", () => {
    // Eleven strategies, the Cooper shape. The narrator writes one short
    // paragraph each; four are dropped as restatements of their cards.
    const strategies = Array.from({ length: 11 }, (_, i) => ({
      name: `Strategy ${i + 1}`,
      rows: [row({ what: "Annual amount", area: "Savings", detail: [] })],
    }));
    const chapter = recommend(
      buildPlanStoryData(
        deckCtx(input({ hasProposal: true, strategies, facts: [] }), "Proposed"),
        PROPOSED,
      ),
    );
    expect(chapter.paragraphs.length).toBeLessThanOrEqual(MAX_PARAGRAPHS_WITH_CARDS);
    // What was dropped is SAID. The card overflow leads, since it can say how many.
    expect(chapter.overflowNote).not.toBe("");
  });
});

/**
 * The glossary, which is the one thing on this page that must survive a
 * Generate.
 *
 * Stored text wins over the narrator, and the model is asked for two short
 * paragraphs — so a glossary written in PROSE would print only on decks nobody
 * ever generated. Carrying it as a structured field is what makes it
 * unreachable by the model, exactly as the strategy cards and the next steps
 * already are. `things-to-know.test.ts` owns the other half: that the narrator
 * writes none of it.
 */
describe("buildPlanStoryData — the glossary block", () => {
  const glossaryChapter = (text: Partial<Record<ChapterId, string>> = {}) =>
    buildPlanStoryData(deckCtx(input({}, text)), PLAN_STORY_OPTIONS_DEFAULT).chapters.find(
      (c) => c.chapterId === "thingsToKnow",
    )!;

  it("carries every plain-English term on the chapter that prints them", () => {
    expect(glossaryChapter().glossary).toEqual([...GLOSSARY]);
  });

  /** ⭐ The case the whole shape exists for. A generated draft replaces the
   *  prose and cannot touch the list under it. */
  it("keeps the terms when a generated draft has replaced the prose", () => {
    const chapter = glossaryChapter({
      thingsToKnow: "A plan is a projection, not a promise. Here's what sits underneath yours.",
    });
    expect(chapter.paragraphs).toHaveLength(1);
    expect(chapter.glossary).toEqual([...GLOSSARY]);
  });

  it("gives every other chapter an empty one, whatever its layout", () => {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true })), PROPOSED);
    for (const chapter of data.chapters) {
      if (chapter.chapterId === "thingsToKnow") continue;
      expect(chapter.glossary, chapter.chapterId).toEqual([]);
    }
  });

  /**
   * The cap, proved by GROWING the list rather than by restating the slice.
   *
   * `GLOSSARY` is a module constant — eleven entries today, against a cap of
   * twelve — so the only way to reach the bound is to swap the module. Without
   * this, a mutant that dropped the `slice` survives until someone adds the
   * thirteenth term to `glossary.ts` and every client's report grows a sheet.
   */
  it("drops the terms past the cap and says how many, rather than adding a sheet", async () => {
    const OVER = 3;
    vi.resetModules();
    vi.doMock("@/lib/presentations/story/glossary", () => ({
      GLOSSARY: Array.from({ length: MAX_GLOSSARY_TERMS + OVER }, (_, i) => ({
        term: `term ${i + 1}`,
        plain: "what it means, in one short line.",
      })),
    }));
    try {
      const { buildPlanStoryData: build } = await import("../view-model");
      const chapter = build(deckCtx(input()), PLAN_STORY_OPTIONS_DEFAULT).chapters.find(
        (c) => c.chapterId === "thingsToKnow",
      )!;
      expect(chapter.glossary).toHaveLength(MAX_GLOSSARY_TERMS);
      expect(chapter.overflowNote).toBe(`…and ${OVER} more terms we'll walk through together.`);
    } finally {
      vi.doUnmock("@/lib/presentations/story/glossary");
      vi.resetModules();
    }
  });

  // The prose above the list is charged a budget of its own — the terms take
  // most of the sheet — so a pasted 20,000-character note is trimmed here rather
  // than pushing the glossary onto a second sheet.
  it("bounds the prose above the list to this sheet's own budget", () => {
    const long = Array.from({ length: 40 }, () => "word ".repeat(50).trim()).join("\n\n");
    const chapter = glossaryChapter({ thingsToKnow: long });
    const words = chapter.paragraphs.join(" ").split(/\s+/u).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(BUDGET_WORDS_GLOSSARY);
    // …and well under what a chapter with nothing beneath its prose may spend.
    expect(words).toBeLessThan(SHEET_BUDGET_WORDS);
    expect(chapter.overflowNote).not.toBe("");
  });
});

/**
 * Moved here from `plan-story.test.tsx` when the rule moved. It used to live in
 * `chapter-pdf.tsx`, which renders — but the sheet budget is spent HERE, and a
 * paragraph the renderer was always going to discard must not be charged for, or
 * a chapter carrying a full set of cards announces dropped prose nobody lost.
 */
describe("a strategy the prose already spelled out", () => {
  const STRATEGY = {
    name: "Delay Social Security",
    rows: [row({ what: "Alan's Social Security", detail: ["Claim age: 67 to 70"] })],
  };
  const DETAIL = "Claim age: 67 to 70";

  const recommend = (text: string) =>
    buildPlanStoryData(
      deckCtx(input({ hasProposal: true, strategies: [STRATEGY] }, { whatWeRecommend: text })),
      PROPOSED,
    ).chapters.find((c) => c.chapterId === "whatWeRecommend")!;

  it("drops the narrator's own one-line restatement", () => {
    const chapter = recommend(`Delay Social Security — ${DETAIL}.`);
    expect(chapter.paragraphs).toEqual([]);
    // The card keeps every field — it is the one that also says WHAT WE'D DO.
    expect(chapter.strategies[0].name).toBe("Delay Social Security");
    expect(chapter.strategies[0].detail).toBe(DETAIL);
  });

  it("drops the no-quotable-clause restatement too", () => {
    // `describe()`'s other shape, taken when the changes table's figure fails
    // the fact gate: the sentence is name-only.
    expect(recommend("Delay Social Security.").paragraphs).toEqual([]);
  });

  it("keeps prose that opens with the strategy's name and then says something", () => {
    const lead = "Delay Social Security — it is the single biggest lever in your plan.";
    expect(recommend(lead).paragraphs).toEqual([lead]);
  });

  it("keeps prose that never names the strategy at all", () => {
    const lead = "We're recommending two changes, and both are about timing.";
    expect(recommend(lead).paragraphs).toEqual([lead]);
  });

  it("keeps every paragraph when the chapter has no cards to duplicate", () => {
    const line = "Delay Social Security — Claim age: 67 to 70.";
    const chapter = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, strategies: [] }, { whatWeRecommend: line })),
      PROPOSED,
    ).chapters.find((c) => c.chapterId === "whatWeRecommend")!;
    expect(chapter.paragraphs).toEqual([line]);
  });

  // Dropping a restatement is not "nothing fits" — the note would tell a client
  // the report is incomplete when the card says the very same thing.
  it("prints no overflow note for a paragraph the card already carries", () => {
    expect(recommend(`Delay Social Security — ${DETAIL}.`).overflowNote).toBe("");
  });
});

describe("twoUp figures", () => {
  /** A twoUp chapter that needs a proposal, with its prose coming from storage
   *  exactly as the export loader supplies it — so the case is about the FIGURE
   *  COLUMN and not about the paragraph beside it. */
  const WITH_LAST: PlanStoryOptions = {
    ...PROPOSED,
    sections: { ...PROPOSED.sections, willTheMoneyLast: true },
  };
  const STORED = { willTheMoneyLast: "Your plan holds up in almost every run we tested." };

  function fact(id: string, label: string, display: string, chapters?: ChapterId[]): Fact {
    return { id, label, display, raw: null, ...(chapters ? { chapters } : {}) };
  }

  const CONFIDENCE = fact("outcome.confidence.proposed", "Confidence, proposed plan", "96.3%", [
    "willTheMoneyLast",
  ]);

  function chapterWith(facts: Fact[], id: ChapterId = "willTheMoneyLast"): PlanStoryChapterView {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true, facts }, STORED)), WITH_LAST);
    return data.chapters.find((c) => c.chapterId === id)!;
  }

  it("carries the chapter's own facts as labelled figures", () => {
    const chapter = chapterWith([CONFIDENCE]);
    expect(chapter.layout).toBe("twoUp");
    expect(chapter.figures.map((f) => f.value)).toContain("96.3%");
  });

  it("uses the fact's own label, so a figure card and the prose cannot disagree", () => {
    // The same two strings the prompt showed the model. A card built from a
    // second formatting of the same number is how a page ends up printing
    // "96.3%" beside prose that says "96%".
    const card = chapterWith([CONFIDENCE]).figures.find((f) => f.value === "96.3%")!;
    expect(card.label).toBe("Confidence, proposed plan");
  });

  it("prints only the figures scoped to this chapter", () => {
    // Task 5's scoping is what makes the column readable: unscoped, every
    // chapter's card stack would carry the whole pack's headline figures.
    const elsewhere = fact("today.assets", "What you own", "$2M", ["whatYouHave"]);
    const chapter = chapterWith([CONFIDENCE, elsewhere]);
    expect(chapter.figures.map((f) => f.value)).toEqual(["96.3%"]);
  });

  it("leaves out a quoted figure — it is one change's wording, not a headline", () => {
    const quoted = fact("quoted.$850k", 'Sell the rental — from "…$850k sale"', "$850k", [
      "willTheMoneyLast",
    ]);
    const chapter = chapterWith([CONFIDENCE, quoted]);
    expect(chapter.figures.map((f) => f.value)).toEqual(["96.3%"]);
  });

  it("caps the figures so the column cannot overflow the sheet", () => {
    const many = Array.from({ length: MAX_FIGURE_CARDS + 3 }, (_, i) =>
      fact(`outcome.n${i}`, `Figure ${i}`, `${i}%`, ["willTheMoneyLast"]),
    );
    expect(chapterWith(many).figures).toHaveLength(MAX_FIGURE_CARDS);
  });

  it("spends a smaller prose budget than a full-width chapter", () => {
    // The figure column takes 170pt plus its gap out of the text measure, so the
    // same words cost half again as many lines. Five paragraphs of forty words
    // pass through a heroProse chapter whole and are trimmed on a twoUp one —
    // a shared budget would overflow every twoUp sheet while measuring as if it
    // fit, because a page count of 1 cannot see clipping.
    const FORTY = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const long = Array.from({ length: 5 }, () => FORTY).join("\n\n");
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true }, { willTheMoneyLast: long, whatYouHave: long })),
      WITH_LAST,
    );
    const twoUp = data.chapters.find((c) => c.chapterId === "willTheMoneyLast")!;
    const hero = data.chapters.find((c) => c.chapterId === "whatYouHave")!;
    expect(hero.paragraphs).toHaveLength(5);
    expect(hero.overflowNote).toBe("");
    expect(twoUp.paragraphs.length).toBeLessThan(5);
    expect(twoUp.overflowNote).not.toBe("");
  });

  it("is empty for every other layout", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, facts: [CONFIDENCE] }, STORED)),
      WITH_LAST,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatYouHave")!.figures).toEqual([]);
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.figures).toEqual([]);
  });
});

describe("checklist steps", () => {
  const WITH_NEXT: PlanStoryOptions = {
    ...PROPOSED,
    sections: { ...PROPOSED.sections, whatHappensNext: true },
  };
  const STORED = { whatHappensNext: "Here's what we each take away from today." };

  function step(i: number) {
    return { text: `Do the ${i}th thing.`, owner: "Cooper", when: "This month" };
  }

  function chapterWith(nextSteps: StoryContext["nextSteps"]): PlanStoryChapterView {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, nextSteps }, STORED)),
      WITH_NEXT,
    );
    return data.chapters.find((c) => c.chapterId === "whatHappensNext")!;
  }

  it("carries the household's next steps onto the chapter that lists them", () => {
    const chapter = chapterWith([step(1), step(2)]);
    expect(chapter.layout).toBe("checklist");
    expect(chapter.steps.map((s) => s.text)).toEqual(["Do the 1th thing.", "Do the 2th thing."]);
  });

  it("prints the lead paragraph with no steps rather than nothing", () => {
    const chapter = chapterWith(undefined);
    expect(chapter.steps).toEqual([]);
    expect(chapter.paragraphs).toEqual(["Here's what we each take away from today."]);
    expect(chapter.overflowNote).toBe("");
  });

  it("caps the list at what one sheet holds, and says what it dropped", () => {
    const chapter = chapterWith(Array.from({ length: MAX_STEPS + 2 }, (_, i) => step(i)));
    expect(chapter.steps).toHaveLength(MAX_STEPS);
    expect(chapter.overflowNote).toBe("…and 2 more steps we'll walk through together.");
  });

  it("says one step in the singular", () => {
    const chapter = chapterWith(Array.from({ length: MAX_STEPS + 1 }, (_, i) => step(i)));
    expect(chapter.overflowNote).toBe("…and one more step we'll walk through together.");
  });

  it("is empty for every other layout", () => {
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true, nextSteps: [step(1)] }, STORED)),
      WITH_NEXT,
    );
    expect(data.chapters.find((c) => c.chapterId === "whatYouHave")!.steps).toEqual([]);
    expect(data.chapters.find((c) => c.chapterId === "whatWeRecommend")!.steps).toEqual([]);
  });

  it("spends a smaller prose budget than a full-width chapter", () => {
    // The steps ARE the chapter; the prose above them is a lead-in.
    const FORTY = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const long = Array.from({ length: 3 }, () => FORTY).join("\n\n");
    const data = buildPlanStoryData(
      deckCtx(input({ hasProposal: true }, { whatHappensNext: long, whatYouHave: long })),
      WITH_NEXT,
    );
    const list = data.chapters.find((c) => c.chapterId === "whatHappensNext")!;
    const hero = data.chapters.find((c) => c.chapterId === "whatYouHave")!;
    expect(hero.paragraphs).toHaveLength(3);
    expect(list.paragraphs.length).toBeLessThan(3);
    expect(list.overflowNote).toBe(
      "…there's more here than fits this page — we'll walk through the rest together.",
    );
  });
});
