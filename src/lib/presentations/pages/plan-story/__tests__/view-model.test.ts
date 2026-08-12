import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import type { Fact } from "@/lib/presentations/story/facts";
import type { ChapterId, StoryContext } from "@/lib/presentations/story/types";
import {
  buildPlanStoryData,
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
      sections: { planInOnePage: false, whatYouHave: false, whatWeRecommend: false },
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
    expect(chapterIds(data)).toEqual(["planInOnePage", "whatYouHave"]);
  });

  it("keeps it once a scenario is picked", () => {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true })), PROPOSED);
    expect(chapterIds(data)).toEqual(["planInOnePage", "whatYouHave", "whatWeRecommend"]);
  });

  it("decides from the options alone, not from the loaded story's own flag", () => {
    // The two agree in production because the export loader derives the story's
    // `hasProposal` from this same `scenarioId`. The builder must still key off
    // the options: `estimatePlanStoryPageCount` has no story to consult, so the
    // moment the builder consults one they can disagree about how many pages
    // this page occupies — which is the defect this whole rule exists to close.
    const optimistic = buildPlanStoryData(deckCtx(input({ hasProposal: false })), PROPOSED);
    expect(chapterIds(optimistic)).toEqual(["planInOnePage", "whatYouHave", "whatWeRecommend"]);
    expect(paragraphsOf(optimistic, "whatWeRecommend")).toEqual([
      "We aren't suggesting changes to the plan this time.",
    ]);

    const pessimistic = buildPlanStoryData(
      deckCtx(input({ hasProposal: true })),
      PLAN_STORY_OPTIONS_DEFAULT,
    );
    expect(chapterIds(pessimistic)).toEqual(["planInOnePage", "whatYouHave"]);
  });

  it("carries the registry's title and layout onto each chapter", () => {
    const data = buildPlanStoryData(deckCtx(input({ hasProposal: true })), PROPOSED);
    expect(data.chapters.map((c) => c.title)).toEqual([
      "Your plan, in one page",
      "What you have",
      "What we're recommending, and why",
    ]);
    expect(data.chapters.map((c) => c.layout)).toEqual([
      "heroProse",
      "heroProse",
      "strategyCards",
    ]);
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
  const SECTION_SETS = [false, true].flatMap((planInOnePage) =>
    [false, true].flatMap((whatYouHave) =>
      [false, true].map((whatWeRecommend) => ({ planInOnePage, whatYouHave, whatWeRecommend })),
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
    for (const preset of ["full", "brief"] as const) {
      for (const scenarioId of SCENARIO_IDS) {
        const options = applyPreset({ ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId }, preset);
        const ctx = deckCtx(input({ hasProposal: planStoryHasProposal(options) }));
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
    expect(estimatePlanStoryPageCount(undefined as never, PROPOSED)).toBe(3);
  });
});
