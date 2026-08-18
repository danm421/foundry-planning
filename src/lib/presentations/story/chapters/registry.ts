// The chapter list, and everything the rest of the report needs to know about a
// chapter without importing it: its heading, the layout that prints it, the
// AI-off narrator, and the one line that tells the model what it is for.
import { CHAPTER_IDS, type ChapterId, type ChapterLength, type StoryContext } from "../types";
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
import { narrateProtectingYourFamily } from "./protecting-your-family";
import { narrateHealthCareCosts } from "./health-care-costs";
import { narrateWhatHappensNext } from "./what-happens-next";
import { narrateThingsToKnow } from "./things-to-know";

export type ChapterLayout =
  | "heroProse"
  | "twoUp"
  | "strategyCards"
  | "checklist"
  | "glossary"
  | "chartWithProse";

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
    layout: "chartWithProse",
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
    layout: "chartWithProse",
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
    narrate: narrateProtectingYourFamily,
    requiresProposal: false,
    coverage: true,
    // No policies on file, no model call. The sheet is still reserved and the
    // narrator's empty state prints on it — see `available` above.
    available: (ctx) => ctx.facts.some((f) => f.id.startsWith("cover.")),
    brief:
      "What their cover would do for the survivor if one of them died tomorrow, and where it falls short of what the plan needs.",
  },
  healthCareCosts: {
    id: "healthCareCosts",
    title: "Health care costs in retirement",
    layout: "twoUp",
    narrate: narrateHealthCareCosts,
    requiresProposal: false,
    coverage: true,
    available: (ctx) => ctx.facts.some((f) => f.id.startsWith("medicare.")),
    brief:
      "What health care is likely to cost them once work stops, and how much of it the plan already carries.",
  },
  whatHappensNext: {
    id: "whatHappensNext",
    title: "What happens next",
    layout: "checklist",
    narrate: narrateWhatHappensNext,
    requiresProposal: false,
    coverage: false,
    brief: "What each of us does next, and by when. One line of lead-in, then the steps.",
  },
  thingsToKnow: {
    id: "thingsToKnow",
    title: "Things to know",
    // The glossary is PRINTED BY THE LAYOUT, not written by the narrator — the
    // one thing on this page that has to survive a Generate. Stored text wins
    // over `narrate()` at export, and a model asked for three short paragraphs
    // will never write eleven definitions back, so a prose glossary would appear
    // only on decks nobody generated. The same shape `steps`, `figures` and the
    // strategy cards already use.
    layout: "glossary",
    narrate: narrateThingsToKnow,
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

/**
 * The chapters a story on THIS scenario could narrate — derived from the ref
 * alone, so asking costs nothing and can be asked before any facts exist.
 *
 * ⚠️⚠️ A SUPERSET of what finally gets written, never the list itself. The full
 * answer also reads `available` and `hasSomethingToPropose`, both of which need
 * the loaded context; a proposal carrying no changes is in here and is still
 * refused later. That is the correct direction to be wrong in — see
 * `StoryRun.candidates`, whose invariant this is.
 *
 * Three callers need the identical answer and must not each derive it: the
 * loader scopes its solves to it, the generate route refuses an impossible
 * chapter with it before spending anything, and the chapter list tells the panel
 * which rows can offer Regenerate at all. Three copies of `scenarioId !== "base"`
 * is how the button comes back on a row the route can only refuse.
 *
 * Lives HERE rather than with the loader for a second reason: the chapter list
 * is re-read after every keystroke-blur, and importing the loader would pull the
 * projection engine into that route for one boolean.
 */
export function storyCandidates(scenarioId: string): ChapterId[] {
  const hasProposedRef = scenarioId !== "base";
  return CHAPTER_IDS.filter((c) => hasProposedRef || !CHAPTERS[c].requiresProposal);
}

/**
 * The chapters printed as a list of the advisor's own next steps.
 *
 * Exported for `load-context.ts`, which skips the `plan_observations` read when
 * no chapter on the report can print it — the same shape as `COVER_CHAPTERS` and
 * `SPEND_CHAPTERS`, and derived here for the same reason. The consumers are
 * `pages/plan-story/view-model.ts` and `chapter-pdf.tsx`, and BOTH branch on
 * `layout === "checklist"`. Gating on a chapter-id literal instead would survive
 * a rename (the union checks that) but not a layout reassignment: a second
 * checklist chapter would render `story.nextSteps` while the loader, handed an
 * explicit chapter list, had skipped the read — printing "nothing's been written
 * down yet" over a list the advisor did write.
 */
export const CHECKLIST_CHAPTERS: readonly ChapterId[] = CHAPTER_IDS.filter(
  (id) => CHAPTERS[id].layout === "checklist",
);

/**
 * What to ask the model for, by LAYOUT — the one instruction in `prompts.ts`
 * that cannot be the same sentence for every chapter.
 *
 * `pages/plan-story/view-model.ts` gives a checklist chapter 35 words against a
 * full sheet's 300 and prints "there's more here than fits this page" over
 * whatever it drops. Ask that chapter for four paragraphs and the trim note
 * becomes its normal ending rather than its exception, on the one sheet whose
 * real content is the list underneath it.
 *
 * A `Record`, not a branch in `prompts.ts`: it lives beside the layouts it keys
 * on, and a new layout has to answer this question rather than inheriting an
 * ask that was written for a different sheet.
 *
 * ⚠️ The WORDS, never a number read from the budget. `prompts.ts` records the
 * measured finding that a number in this prompt acts as an anchor the model
 * writes past, so the two are tuned independently and deliberately.
 */
const OUTPUT_ASK: Record<ChapterLayout, string> = {
  heroProse: "Output: clean Markdown, 2 to 4 short paragraphs, no headings, no preamble.",
  /**
   * ⭐ NOT the same sentence as `heroProse`, though it was until 2026-08-14.
   *
   * A twoUp sheet gives its prose 130 words against heroProse's 300 — not
   * because the sheet is fuller, but because the figure column takes 170pt plus
   * its gap out of the text measure, so the same words cost half again as many
   * LINES (`pages/plan-story/view-model.ts#BUDGET_WORDS_TWO_UP`). Five of the
   * fourteen chapters print here, and asking them for a heroProse chapter's
   * prose made the trim note their normal ending rather than their exception.
   *
   * ⚠️ The SHAPE, not the number. `prompts.ts` records the measured finding that
   * a word count in this prompt acts as an anchor the model writes past by about
   * five words — so "TWO short paragraphs" is the instruction and 130 stays in
   * the view-model as the backstop. The two are tuned independently and
   * deliberately, exactly as the sentence-length aim and its gate are.
   */
  twoUp:
    "Output: clean Markdown, TWO short paragraphs, no headings, no preamble. There is a column of figures printed beside your text — do not list those figures again in prose.",
  strategyCards: "Output: clean Markdown, 2 to 4 short paragraphs, no headings, no preamble.",
  checklist:
    "Output: clean Markdown, ONE short paragraph of at most two sentences, no headings, no preamble. Do not list the steps themselves — they are printed under your text by the page layout.",
  // The same sentence pattern as `checklist`, and for the same reason: the list
  // under the prose is printed by the layout, so a model that writes its own
  // copy of it spends the sheet twice. Two paragraphs rather than four — the
  // glossary is most of this sheet.
  glossary:
    "Output: clean Markdown, ONE or TWO short paragraphs, no headings, no preamble. Do not explain the technical terms themselves — the plain-English list of them is printed under your text by the page layout.",
  /**
   * The mirror of `twoUp` above, and deliberately its opposite.
   *
   * A twoUp sheet prints a column of figures and tells the model not to repeat
   * them: the cards already say those numbers, so prose that lists them again
   * spends the sheet twice. A chart says nothing in words — it is a shape — so
   * the numbers behind it reach the client ONLY if the prose says them, and
   * `validate/chart-citation.ts` refuses a draft that does not.
   *
   * ⚠️ No word count, for the reason this file documents twice already: a number
   * here is an anchor the model writes past by about five words. The shape is
   * the instruction; `BUDGET_WORDS_CHART` is the backstop.
   */
  chartWithProse:
    "Output: clean Markdown, TWO short paragraphs, no headings, no preamble. A chart is printed above your text — say what it shows, and name at least one of its figures in your own sentence.",
};

/**
 * How the ask MOVES with the advisor's length setting.
 *
 * Concatenated onto the layout's own sentence rather than replacing it, so the
 * layout keeps naming the SHAPE and the advisor only names the amount.
 *
 * ⚠️ That is not on its own enough, and the first version of this Record proved
 * it. A modifier can contradict the sentence it lands on: `full` on a checklist
 * chapter read "…ONE short paragraph of at most two sentences … Use the whole
 * space you have; this chapter carries more than one idea." Concatenation was
 * never the safeguard — `FIXED_SHAPE_ASK` below is.
 *
 * ⚠️ CONCATENATED on the SAME line — never added as a separate entry in
 * `prompts.ts#systemParts`. That prompt is one instruction per line and a
 * chapter's ask is one instruction; a second line would read as a second rule.
 *
 * ⚠️ No numbers, for the reason `prompts.ts` documents at length: a word count
 * in this prompt is an anchor the model writes past by about five words.
 *
 * `standard` is the EMPTY string, and that is load-bearing rather than tidy: it
 * makes a default-style prompt byte-identical to the one that existed before
 * this setting (for a household whose name fields carry no padding and no CR or
 * LF — `chapters/prompts.ts#singleLine` has the measurement), so no chapter
 * already generated reads stale on the deploy that adds it. See
 * `types.ts#DEFAULT_CHAPTER_STYLE`.
 */
const LENGTH_MODIFIER: Record<ChapterLength, string> = {
  short: " Keep it to the fewest sentences that still answer the brief.",
  standard: "",
  full: " Use the whole space you have; this chapter carries more than one idea.",
};

/**
 * Which layouts' asks name a FIXED SHAPE — a ceiling in sentences or paragraphs
 * that the prose must sit inside because the sheet's real content is the LIST
 * printed under it.
 *
 * `checklist` and `glossary` are those two, and `view-model.ts` is why: they get
 * 35 and 90 words against a full sheet's 300, then print
 * "…there's more here than fits this page" over whatever they drop. A chapter
 * asked for more prose than its sheet holds makes that note its normal ending
 * rather than its exception — the defect `OUTPUT_ASK` above and `view-model.ts`
 * were written to close (Wave A, Task 3), which a length modifier applied
 * blindly re-opens on exactly these two chapters.
 *
 * So `full` is not SOFTENED for them, it is not applied: `chapterOutputAsk`
 * hands back the layout's own sentence unchanged, and there is no wording left
 * for a model to weigh against the ceiling the layout set. `short` still applies —
 * asking for fewer sentences than a ceiling allows is coherent, and cannot make
 * the trim note fire.
 *
 * A `Record`, like `OUTPUT_ASK` itself, so a seventh layout has to ANSWER this
 * rather than inherit an answer written for a different sheet.
 */
const FIXED_SHAPE_ASK: Record<ChapterLayout, boolean> = {
  heroProse: false,
  twoUp: false,
  strategyCards: false,
  checklist: true,
  glossary: true,
  // The prose IS the argument on this sheet, not a lead-in to a printed list —
  // unlike `checklist` and `glossary`, whose real content is the list under
  // them. So the advisor's `full` setting applies normally.
  chartWithProse: false,
};

/** ⚠️ `length` is REQUIRED. It was defaulted, which made the one argument in
 *  this threading whose omission the compiler could not see. */
export function chapterOutputAsk(chapterId: ChapterId, length: ChapterLength): string {
  const layout = CHAPTERS[chapterId].layout;
  const suppressed = length === "full" && FIXED_SHAPE_ASK[layout];
  return OUTPUT_ASK[layout] + (suppressed ? "" : LENGTH_MODIFIER[length]);
}

/**
 * Is `full` a SILENT NO-OP on this chapter?
 *
 * True for exactly the layouts `FIXED_SHAPE_ASK` marks, so it cannot drift from
 * the suppression `chapterOutputAsk` actually performs — the same rule
 * `chapterEnumerates` follows above, and for the same reason: a second copy of
 * `layout === "checklist"` is how the answer starts disagreeing with itself.
 *
 * The review panel is the caller. Suppression happens BEFORE the prompt is
 * built, so a chapter set to `full` here produces a prompt and a `sourceHash`
 * byte-identical to `standard` — the advisor changes the setting, presses
 * Regenerate, waits, and reads the same prose back. Unannotated, that is
 * indistinguishable from the model ignoring them.
 *
 * ⚠️ An annotation, never a disabled or missing option: the report-level
 * control sets all fourteen chapters at once, so these two legitimately HOLD
 * `full`, and a `<select>` whose value is absent from its options renders a
 * DIFFERENT option as selected. `short` still applies here, so the control has
 * real work to do either way.
 */
export function chapterIgnoresFullLength(chapterId: ChapterId): boolean {
  return FIXED_SHAPE_ASK[CHAPTERS[chapterId].layout];
}
