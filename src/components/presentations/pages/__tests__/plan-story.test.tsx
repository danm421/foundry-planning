import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { planStoryPage, type BuildDataContext } from "@/components/presentations/registry";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PlanStoryPagePdf } from "@/components/presentations/pages/plan-story/page-pdf";
import { PlanStoryChapterPdf } from "@/components/presentations/pages/plan-story/chapter-pdf";
import {
  PLAN_STORY_OPTIONS_DEFAULT,
  applyPreset,
  type PlanStoryOptions,
} from "@/lib/presentations/pages/plan-story/options-schema";
import {
  buildPlanStoryData,
  type PlanStoryChapterView,
  type PlanStoryContextInput,
  type PlanStoryPageData,
} from "@/lib/presentations/pages/plan-story/view-model";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";
import { GLOSSARY } from "@/lib/presentations/story/glossary";

/** Every chapter of the arc switched off — the advisor-turned-it-all-off case. */
function allSectionsOff(): PlanStoryOptions["sections"] {
  return Object.fromEntries(
    CHAPTER_IDS.map((id) => [id, false]),
  ) as PlanStoryOptions["sections"];
}

const FRAME = {
  firmName: "Foundry",
  clientName: "Bradshaw",
  reportDate: "2026-08-11",
  pageIndex: 1,
  totalPages: 2,
  accent: { accent: "#0f7d6c", tint: "#e4f1ec" },
};

/**
 * Every string this page would print, in document order.
 *
 * The PDF tree is data, not DOM: `@react-pdf/renderer` re-exports its primitives
 * from `@react-pdf/primitives`, where `Text` is the string `"TEXT"` — so the only
 * function-typed nodes in this tree are our own components, and walking it means
 * calling them. That is what makes "does this sentence print twice" answerable
 * without a two-second render.
 */
function textOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: unknown }>;
    if (typeof el.type === "function") {
      return textOf((el.type as (props: unknown) => unknown)(el.props));
    }
    return textOf(el.props.children);
  }
  return [];
}

/** The physical pages this render produces — one `PageFrame` is one sheet. */
function pageFrames(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(pageFrames);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === PageFrame) return [el];
  return pageFrames(el.props.children);
}

function render(data: PlanStoryPageData) {
  return PlanStoryPagePdf({ data, ...FRAME });
}

function chapter(over: Partial<PlanStoryChapterView> = {}): PlanStoryChapterView {
  return {
    chapterId: "planInOnePage",
    title: "Your plan, in one page",
    layout: "heroProse",
    paragraphs: ["Your plan holds."],
    strategies: [],
    figures: [],
    steps: [],
    glossary: [],
    overflowNote: "",
    ...over,
  };
}

function pageData(chapters: PlanStoryChapterView[]): PlanStoryPageData {
  return { title: "Your Plan", subtitle: "Proposed", isEmpty: false, emptyMessage: "", chapters };
}

/** `buildPlanStoryData` reads exactly two fields off the deck context; the rest
 *  of `BuildDataContext` is a projection and a dozen branding fields it cannot
 *  reach. Same cast the view-model's own suite uses. */
function deckCtx(planStory: PlanStoryContextInput | undefined): BuildDataContext {
  return { planStory, scenarioLabel: "Base Case" } as unknown as BuildDataContext;
}

function storyInput(over: Partial<PlanStoryContextInput["story"]> = {}): PlanStoryContextInput {
  return {
    story: {
      household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
      scenarioLabel: "Base Case",
      documentRole: "standalone",
      hasProposal: false,
      strategies: [],
      goals: [],
      facts: [],
      ...over,
    },
    text: {},
  };
}

const ALL_OFF: PlanStoryOptions = {
  ...PLAN_STORY_OPTIONS_DEFAULT,
  sections: allSectionsOff(),
};

describe("planStoryPage registry entry", () => {
  it("is filed under an existing category, never a new one", () => {
    expect(planStoryPage.category).toBe("Framing");
  });

  it("estimates its page count from options alone", () => {
    // One page per chapter the default switches on, less the ones with nothing
    // to recommend — no scenario is picked here.
    expect(planStoryPage.estimatePageCount(undefined as never, PLAN_STORY_OPTIONS_DEFAULT)).toBe(
      CHAPTER_IDS.filter((id) => !CHAPTERS[id].requiresProposal).length,
    );
  });

  it("summarizes the brief preset for the launcher row", () => {
    expect(planStoryPage.summarizeOptions(applyPreset(PLAN_STORY_OPTIONS_DEFAULT, "brief"))).toContain(
      "Executive brief",
    );
  });

  it("parses its own defaults", () => {
    expect(planStoryPage.optionsSchema.parse(PLAN_STORY_OPTIONS_DEFAULT)).toEqual(
      PLAN_STORY_OPTIONS_DEFAULT,
    );
  });

  it("wires renderPdf to the page component", () => {
    expect(typeof planStoryPage.renderPdf).toBe("function");
  });

  it("renders one physical page per enabled chapter", () => {
    // NOT `planStoryPage.renderPdf(...)` — that element's props ARE the input,
    // so it has no `children`. Call the component function directly.
    const el = PlanStoryPagePdf({
      data: pageData([
        chapter(),
        chapter({
          chapterId: "whatWeRecommend",
          title: "What we're recommending, and why",
          layout: "strategyCards",
          paragraphs: ["Two changes."],
          strategies: [
            { name: "Delay Social Security", what: "Alan's SS", detail: "67 becomes 70" },
          ],
        }),
      ]),
      ...FRAME,
    });
    const kids = (el.props as { children: unknown[] }).children;
    expect(Array.isArray(kids) ? kids.length : 1).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X2 — the empty page prints the sentence the VIEW-MODEL chose.
//
// Two different things end this page with nothing to print and they must not
// read the same: an advisor who switched every chapter off should be told so,
// and one whose story failed to load must not be told they did something they
// didn't. Built through `buildPlanStoryData` on purpose — a renderer that
// printed a sentence of its own would still satisfy a fixture-only test.
// ─────────────────────────────────────────────────────────────────────────────
describe("PlanStoryPagePdf — the empty page", () => {
  const missing = buildPlanStoryData(deckCtx(undefined), PLAN_STORY_OPTIONS_DEFAULT);
  const switchedOff = buildPlanStoryData(deckCtx(storyInput()), ALL_OFF);

  it("has two distinct sentences to tell apart", () => {
    expect(missing.emptyMessage).not.toBe(switchedOff.emptyMessage);
  });

  it("says the story is unavailable when the story never loaded", () => {
    const printed = textOf(render(missing));
    expect(printed).toContain(missing.emptyMessage);
    expect(printed).not.toContain(switchedOff.emptyMessage);
  });

  it("says the chapters are switched off when that is what happened", () => {
    const printed = textOf(render(switchedOff));
    expect(printed).toContain(switchedOff.emptyMessage);
    expect(printed).not.toContain(missing.emptyMessage);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X5 — a paragraph that says nothing the cards don't already say is dropped.
//
// On the AI-off path `narrateWhatWeRecommend` writes one sentence per strategy
// ("Delay Social Security — Claim age: 67 → 70.") and `generateChapter` stores
// it as the chapter's text, so by export time it arrives as prose and the card
// below repeats it verbatim. The card is the richer of the two, so the paragraph
// is what goes — but only when striking the strategy's name and clause out of it
// leaves nothing but punctuation.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// The page-count agreement. `document.tsx` numbers every page after this one —
// and the TOC's start pages, and the deck's total — from `estimatePageCount`
// alone, so the render has to produce exactly that many sheets.
// ─────────────────────────────────────────────────────────────────────────────
describe("PlanStoryPagePdf — sheets rendered vs. sheets reserved", () => {
  it("renders the one sheet the estimate reserves for an empty story", () => {
    const data = buildPlanStoryData(deckCtx(storyInput()), ALL_OFF);
    expect(pageFrames(render(data))).toHaveLength(
      planStoryPage.estimatePageCount(undefined as never, ALL_OFF),
    );
  });

  it("renders one sheet per chapter for a full proposed story", () => {
    const options: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };
    const data = buildPlanStoryData(
      deckCtx(
        storyInput({
          hasProposal: true,
          strategies: [
            {
              name: "Delay Social Security",
              rows: [
                {
                  area: "Income",
                  what: "Alan's Social Security",
                  op: "edit",
                  before: "67",
                  after: "70",
                  detail: ["Claim age: 67 to 70"],
                },
              ],
            },
          ],
        }),
      ),
      options,
    );
    expect(data.chapters).toHaveLength(CHAPTER_IDS.length);
    expect(pageFrames(render(data))).toHaveLength(
      planStoryPage.estimatePageCount(undefined as never, options),
    );
  });
});

describe("PlanStoryChapterPdf — the twoUp layout", () => {
  const TWO_UP = chapter({
    chapterId: "willTheMoneyLast",
    title: "Will the money last?",
    layout: "twoUp",
    paragraphs: ["Your plan holds up in almost every run we tested."],
    figures: [{ label: "Confidence, proposed plan", value: "96.3%" }],
  });

  /** Every string one chapter prints, in document order. */
  function printed(over: Partial<PlanStoryChapterView> = {}): string[] {
    return textOf(
      PlanStoryChapterPdf({
        chapter: { ...TWO_UP, ...over },
        accent: FRAME.accent,
        eyebrow: "Your Plan · Proposed",
      }),
    );
  }

  it("prints the prose and the figure cards beside it", () => {
    const out = printed();
    expect(out).toContain("Your plan holds up in almost every run we tested.");
    expect(out).toContain("96.3%");
    // The one place a `Fact.label` is client-facing: a caption over its own
    // figure. Gate 5 forbids the model from writing one into a sentence.
    expect(out).toContain("CONFIDENCE, PROPOSED PLAN");
  });

  it("prints no strategy cards, whatever the chapter is carrying", () => {
    // The layout reads its OWN collection. A twoUp chapter that somehow arrived
    // with strategies on it must not print a card the sheet was never budgeted
    // for — the cap that keeps one chapter on one sheet is spent per layout.
    expect(printed({ strategies: [{ name: "Leaked", what: "x", detail: "y" }] })).not.toContain(
      "Leaked",
    );
  });

  it("prints the overflow note inside the prose column", () => {
    expect(printed({ overflowNote: "…there's more here than fits this page." })).toContain(
      "…there's more here than fits this page.",
    );
  });

  it("prints no figure cards on any other layout", () => {
    // The view model empties `figures` off a twoUp chapter, and the renderer
    // reads only its own layout's collection — either one alone would let a
    // figure card reach a heroProse sheet.
    const hero = textOf(
      PlanStoryChapterPdf({
        chapter: { ...TWO_UP, layout: "heroProse" },
        accent: FRAME.accent,
        eyebrow: "",
      }),
    );
    expect(hero).toContain("Your plan holds up in almost every run we tested.");
    expect(hero).not.toContain("96.3%");
  });
});

describe("PlanStoryChapterPdf — a strategy card whose WHAT was refused", () => {
  const CARDS = chapter({
    chapterId: "whatWeRecommend",
    title: "What we're recommending, and why",
    layout: "strategyCards",
    paragraphs: ["Two changes."],
  });

  function printed(strategy: PlanStoryChapterView["strategies"][number]): string[] {
    return textOf(
      PlanStoryChapterPdf({
        chapter: { ...CARDS, strategies: [strategy] },
        accent: FRAME.accent,
        eyebrow: "Your Plan · Proposed",
      }),
    );
  }

  it("prints the heading over the words it introduces", () => {
    const out = printed({ name: "Save more", what: "Teresa's 401(k)", detail: "" });
    expect(out).toContain("WHAT WE'D DO");
    expect(out).toContain("Teresa's 401(k)");
  });

  /**
   * `buildPlanStoryData` hands back `what: ""` when every row's `what` carried a
   * figure the fact pack does not hold — a savings rule's derived name, in the
   * changes table's own rounding. A heading printed over the resulting blank
   * reads to a client as a rendering failure rather than as a withheld figure,
   * so the heading goes with it. The same rule "what it does" already keeps.
   */
  it("prints no heading when there is nothing left to introduce", () => {
    const out = printed({ name: "Save more", what: "", detail: "" });
    expect(out).not.toContain("WHAT WE'D DO");
    // …and the card is still a card: its name survives the refusal.
    expect(out).toContain("Save more");
  });

  /**
   * All three fields refused at once. A possible state of the view rather than a
   * sighting — `chapter-pdf.tsx#isEmptyCard` records which shapes were traced
   * and why none of them reaches it — but `what` used to be unconditional, so
   * until this change a card always printed at least one line.
   */
  it("draws no card at all when all three of its fields were refused", () => {
    const out = printed({ name: "", what: "", detail: "" });
    // ⚠️ The EMPTY STRING is the whole assertion, and it is what tells "no box"
    // from "a box with a blank line in it": a card that is drawn always emits
    // its name `<Text>`, so `textOf` collects a "" for it. Both headings are
    // already conditional, so asserting on those would pass either way.
    expect(out).not.toContain("");
    // The chapter itself still prints — only the empty box is gone.
    expect(out).toContain("Two changes.");
  });

  // The control for the assertion above: a card carrying only a name IS drawn,
  // and its two refused fields contribute no empty string of their own.
  it("still draws a card that has a name and nothing else", () => {
    const out = printed({ name: "Save more", what: "", detail: "" });
    expect(out).toContain("Save more");
    expect(out).not.toContain("");
  });
});

describe("PlanStoryChapterPdf — the checklist layout", () => {
  const STEPS = [
    { text: "Open the Roth account and fund it for this year.", owner: "Cooper", when: "Before 15 April" },
    { text: "Send us the rental's 2025 closing statement.", owner: "You both", when: "This month" },
  ];

  const CHECKLIST = chapter({
    chapterId: "whatHappensNext",
    title: "What happens next",
    layout: "checklist",
    paragraphs: ["Here's what we each take away from today."],
  });

  function printed(over: Partial<PlanStoryChapterView> = {}): string[] {
    return textOf(
      PlanStoryChapterPdf({
        chapter: { ...CHECKLIST, ...over },
        accent: FRAME.accent,
        eyebrow: "Your Plan",
      }),
    );
  }

  it("numbers each step and prints its owner and timing", () => {
    const out = printed({ steps: STEPS });
    expect(out).toContain("1");
    expect(out).toContain("2");
    expect(out).toContain("Open the Roth account and fund it for this year.");
    expect(out).toContain("Cooper · Before 15 April");
  });

  it("prints the lead paragraph above the list", () => {
    const out = printed({ steps: STEPS });
    expect(out.indexOf("Here's what we each take away from today.")).toBeLessThan(
      out.indexOf("Open the Roth account and fund it for this year."),
    );
  });

  it("prints the lead paragraph alone when there are no steps", () => {
    const out = printed({ steps: [] });
    expect(out).toContain("Here's what we each take away from today.");
    expect(out).not.toContain("1");
  });

  it("omits an empty owner or timing rather than printing a stray separator", () => {
    // A separator with nothing on one side of it reads as a missing value rather
    // than as an absent one.
    const out = printed({ steps: [{ text: "Review this again next year.", owner: "", when: "" }] });
    expect(out).toContain("Review this again next year.");
    expect(out.some((line) => line.includes("·"))).toBe(false);
  });

  it("prints whichever half of the meta line exists", () => {
    expect(printed({ steps: [{ text: "Do this.", owner: "Cooper", when: "" }] })).toContain("Cooper");
    expect(printed({ steps: [{ text: "Do this.", owner: "", when: "This month" }] })).toContain(
      "This month",
    );
  });

  it("prints no steps on any other layout", () => {
    expect(printed({ layout: "heroProse", steps: STEPS })).not.toContain(
      "Open the Roth account and fund it for this year.",
    );
  });
});

describe("PlanStoryChapterPdf — the glossary layout", () => {
  const GLOSSARY_CHAPTER = chapter({
    chapterId: "thingsToKnow",
    title: "Things to know",
    layout: "glossary",
    paragraphs: ["A plan is a projection, not a promise."],
    glossary: [...GLOSSARY],
  });

  function printed(over: Partial<PlanStoryChapterView> = {}): string[] {
    return textOf(
      PlanStoryChapterPdf({
        chapter: { ...GLOSSARY_CHAPTER, ...over },
        accent: FRAME.accent,
        eyebrow: "Your Plan",
      }),
    );
  }

  /** The whole point of the structured field: what a client actually reads is
   *  the glossary module, not something a model wrote about it. */
  it("prints every term and its explanation, under the prose", () => {
    const out = printed();
    const joined = out.join(" ");
    for (const entry of GLOSSARY) {
      expect(joined, entry.term).toContain(entry.plain);
    }
    expect(out.indexOf("A plan is a projection, not a promise.")).toBeLessThan(
      out.findIndex((line) => line.includes(GLOSSARY[0].plain)),
    );
  });

  it("capitalises the term the line starts, and keeps the gloss dash", () => {
    expect(printed().join(" ")).toContain(
      `${GLOSSARY[0].term.charAt(0).toUpperCase()}${GLOSSARY[0].term.slice(1)}`,
    );
    expect(printed().some((line) => line.startsWith(" — "))).toBe(true);
  });

  // The list has no lead-in sentence of its own — a model's draft replaces the
  // prose above it, and a list left standing without its introduction is why the
  // label is printed by the layout instead.
  it("labels the block itself rather than leaning on the prose", () => {
    expect(printed({ paragraphs: [] })).toContain("IN PLAIN ENGLISH");
  });

  it("prints no glossary on any other layout", () => {
    expect(printed({ layout: "heroProse" }).join(" ")).not.toContain(GLOSSARY[0].plain);
  });

  // …and nothing to label when the cap or an empty module leaves no terms.
  it("prints no label over an empty list", () => {
    expect(printed({ glossary: [] })).not.toContain("IN PLAIN ENGLISH");
  });
});
