// The chapter list, and everything the rest of the report needs to know about a
// chapter without importing it: its heading, the layout that prints it, the
// AI-off narrator, and the one line that tells the model what it is for.
import type { ChapterId, StoryContext } from "../types";
import { narratePlanInOnePage } from "./plan-in-one-page";
import { narrateWhatWerePlanningFor } from "./what-were-planning-for";
import { narrateWhereTheMoneyGoes } from "./where-the-money-goes";
import { narrateThePathYoureOn } from "./the-path-youre-on";
import { narrateWillTheMoneyLast } from "./will-the-money-last";
import { narrateWhatYouCanSpend } from "./what-you-can-spend";
import { narrateWhatYouHave } from "./what-you-have";
import { narrateWhatWeRecommend } from "./what-we-recommend";
import { narrateWhatsLeftForPeople } from "./whats-left-for-people";
import { narrateWhatYoullPayInTax } from "./what-youll-pay-in-tax";

export type ChapterLayout = "heroProse" | "twoUp" | "strategyCards" | "checklist";

export interface ChapterDef {
  id: ChapterId;
  /** Client-facing chapter heading. */
  title: string;
  layout: ChapterLayout;
  /** The AI-off fallback. Never returns an empty array for a valid context. */
  narrate: (ctx: StoryContext) => string[];
  /** Hidden when there is no proposed scenario. */
  requiresProposal: boolean;
  /**
   * A per-area chapter rather than a spine chapter. Coverage chapters are the
   * ones an advisor who does not handle a household's insurance switches off,
   * and they ALSO self-hide when the underlying data is absent — so "off" and
   * "empty" reach the same clean result. Structural chapters carry the story and
   * have no per-area toggle.
   */
  coverage: boolean;
  /**
   * Does this chapter have anything to say for this household?
   *
   * Only coverage chapters define it — no policies, no chapter 10. Absent means
   * "always", which is what a structural chapter is.
   *
   * ⚠️ NOT a print-list filter, and `printedChapters` deliberately cannot see
   * it. The page count is reserved from the options alone, so a chapter that
   * hid on data the count could not see would mis-number every page after it.
   * A coverage chapter with nothing in it KEEPS its sheet and prints a short
   * honest empty state. This predicate is read by the generate route instead —
   * don't spend a model call on a chapter with nothing to say.
   */
  available?: (ctx: StoryContext) => boolean;
  /** One line telling the model what this chapter is for. */
  brief: string;
}

/**
 * A chapter whose narrator has not landed yet.
 *
 * All fourteen slots exist from this task on, so the page count, the launcher
 * summary, the render and storage agree from the start rather than being
 * reconciled at the end. The chapters themselves arrive one task at a time, and
 * until then this stands in — switched OFF in `PLAN_STORY_OPTIONS_DEFAULT`, so a
 * freshly added page renders exactly the report it renders today.
 *
 * It THROWS in test and returns a neutral sentence in production. A silent empty
 * array would let a half-finished chapter ship as a blank page, which is the one
 * outcome the whole render path is built to make impossible.
 */
/**
 * The chapters whose narrator has actually landed.
 *
 * ONE list, and everything that has to know reads it: the shipped options
 * default switches exactly these on, and every suite that enumerates the arc
 * runs its narrator cases over exactly these. `registry.test.ts` proves the list
 * against the registry itself — every chapter outside it throws — so it cannot
 * drift from the `notYetWritten` calls below.
 *
 * Wave D empties it by filling in narrators; when it holds all fourteen, the
 * placeholder and this constant both go.
 */
export const NARRATED_CHAPTERS: readonly ChapterId[] = [
  "planInOnePage",
  "whatWerePlanningFor",
  "whatYouHave",
  "whereTheMoneyGoes",
  "thePathYoureOn",
  "whatWeRecommend",
  "willTheMoneyLast",
  "whatYouCanSpend",
  "whatsLeftForPeople",
  "whatYoullPayInTax",
];

function notYetWritten(id: ChapterId): (ctx: StoryContext) => string[] {
  return () => {
    if (process.env.NODE_ENV === "test") {
      throw new Error(`chapter "${id}" has no narrator yet — its task has not landed`);
    }
    return ["We'll cover this together."];
  };
}

// Every `brief` is written FOR THE MODEL and the client never sees it, so each
// one is an instruction about the household's money — never a description of a
// page. "What they want the money to do, and when" survives being paraphrased
// onto the client's page; "This page introduces their goals" does not, and
// `prompts.ts` documents the read where exactly that happened.
export const CHAPTERS: Record<ChapterId, ChapterDef> = {
  planInOnePage: {
    id: "planInOnePage",
    title: "Your plan, in one page",
    layout: "heroProse",
    narrate: narratePlanInOnePage,
    requiresProposal: false,
    coverage: false,
    brief:
      "The punchline before the evidence. What the plan says, whether it holds up, and what moved it. This is the page that gets read when nothing else does.",
  },
  whatWerePlanningFor: {
    id: "whatWerePlanningFor",
    title: "What we're planning for",
    layout: "twoUp",
    narrate: narrateWhatWerePlanningFor,
    requiresProposal: false,
    coverage: false,
    brief:
      "Who they are, when they stop working, and what they want the money to do — the goals every figure after this exists to fund.",
  },
  whatYouHave: {
    id: "whatYouHave",
    title: "What you have",
    layout: "heroProse",
    narrate: narrateWhatYouHave,
    requiresProposal: false,
    coverage: false,
    brief:
      "What they own, what they owe, and the difference — plus the honest note that not all of it is spendable.",
  },
  whereTheMoneyGoes: {
    id: "whereTheMoneyGoes",
    title: "Where the money goes",
    layout: "heroProse",
    narrate: narrateWhereTheMoneyGoes,
    requiresProposal: false,
    coverage: false,
    brief:
      "What comes in each year, what goes out, and what is left — and whether the surplus is being put to work.",
  },
  thePathYoureOn: {
    id: "thePathYoureOn",
    title: "The path you're on today",
    layout: "heroProse",
    narrate: narrateThePathYoureOn,
    requiresProposal: false,
    coverage: false,
    brief:
      "Where today's plan ends up if nothing changes. State it honestly — without the problem, no change that follows has anything to solve.",
  },
  whatWeRecommend: {
    id: "whatWeRecommend",
    title: "What we're recommending, and why",
    layout: "strategyCards",
    narrate: narrateWhatWeRecommend,
    requiresProposal: true,
    coverage: false,
    brief:
      "Each strategy in turn: what we'd do, why it fits this household, and the mechanism by which it moves the numbers.",
  },
  willTheMoneyLast: {
    id: "willTheMoneyLast",
    title: "Will the money last?",
    layout: "twoUp",
    narrate: narrateWillTheMoneyLast,
    requiresProposal: true,
    coverage: false,
    brief:
      "How the plan held up across the runs we tested, what the changes did to that confidence, and what it means for them in plain terms.",
  },
  whatYouCanSpend: {
    id: "whatYouCanSpend",
    title: "What you can spend",
    layout: "twoUp",
    narrate: narrateWhatYouCanSpend,
    requiresProposal: true,
    coverage: false,
    brief:
      "How much they can spend a year without running short, and how much the changes move that number.",
  },
  whatsLeftForPeople: {
    id: "whatsLeftForPeople",
    title: "What's left for the people you care about",
    layout: "twoUp",
    narrate: narrateWhatsLeftForPeople,
    requiresProposal: true,
    coverage: true,
    // A coverage chapter with nothing to cover. Read by the GENERATE route to
    // skip a model call, never by `printedChapters` — the sheet stays reserved
    // and prints the narrator's empty state.
    available: (ctx) => ctx.facts.some((f) => f.id.startsWith("estate.")),
    brief:
      "What reaches the people and causes they name, after tax and costs, and what the changes do to it.",
  },
  whatYoullPayInTax: {
    id: "whatYoullPayInTax",
    title: "What you'll pay in tax",
    layout: "twoUp",
    narrate: narrateWhatYoullPayInTax,
    requiresProposal: true,
    coverage: true,
    available: (ctx) => ctx.facts.some((f) => f.id.startsWith("tax.")),
    brief: "What they pay in tax over the life of the plan, and where the changes save it.",
  },
  protectingYourFamily: {
    id: "protectingYourFamily",
    title: "Protecting your family",
    layout: "twoUp",
    narrate: notYetWritten("protectingYourFamily"),
    requiresProposal: false,
    coverage: true,
    brief:
      "What their cover would do for the survivor if one of them died tomorrow, and where it falls short of what the plan needs.",
  },
  healthCareCosts: {
    id: "healthCareCosts",
    title: "Health care costs in retirement",
    layout: "twoUp",
    narrate: notYetWritten("healthCareCosts"),
    requiresProposal: false,
    coverage: true,
    brief:
      "What health care is likely to cost them once work stops, and how much of it the plan already carries.",
  },
  whatHappensNext: {
    id: "whatHappensNext",
    title: "What happens next",
    layout: "checklist",
    narrate: notYetWritten("whatHappensNext"),
    requiresProposal: false,
    coverage: false,
    brief: "What each of us does next, and by when. One line of lead-in, then the steps.",
  },
  thingsToKnow: {
    id: "thingsToKnow",
    title: "Things to know",
    layout: "heroProse",
    narrate: notYetWritten("thingsToKnow"),
    requiresProposal: false,
    coverage: false,
    brief:
      "What the plan assumes about growth, inflation and how long they live, and the plain meaning of the terms used along the way.",
  },
};

/**
 * Does this chapter's job require NAMING things — every strategy in a proposal,
 * every next step a household has to take?
 *
 * Two rules move for one that does: a looser mean sentence length, and the
 * rhetorical-triad rule off. Both are documented where they are defined, in
 * `validate/readability.ts` and `validate/voice.ts`.
 *
 * Derived from the layout rather than stored as a `ChapterDef` field, because a
 * chapter enumerates because of how it is PRINTED — and it lives here, beside
 * the layout it reads, because three callers need the answer: the gate runner,
 * the prompt that tells the model those same two rules, and the local draft
 * harness. Three copies of `layout === "strategyCards"` is how a chapter ends up
 * judged under rules it was never given.
 */
const ENUMERATING_LAYOUTS: readonly ChapterLayout[] = ["strategyCards", "checklist"];

export function chapterEnumerates(chapterId: ChapterId): boolean {
  return ENUMERATING_LAYOUTS.includes(CHAPTERS[chapterId].layout);
}
