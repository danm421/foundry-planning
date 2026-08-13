// Export does NO LLM work. Chapter prose is read from storage by the export
// route and threaded in via `BuildDataContext.planStory`; this builder only
// decides what renders and supplies the deterministic fallback for anything that
// was never generated.
import type { BuildDataContext } from "@/components/presentations/registry";
import { CHAPTERS, type ChapterLayout } from "@/lib/presentations/story/chapters/registry";
import { quotableDetail } from "@/lib/presentations/story/chapters/what-we-recommend";
import type { Fact } from "@/lib/presentations/story/facts";
import { factsForChapter, type ChapterId, type StoryContext } from "@/lib/presentations/story/types";
import { printedChapters, type PlanStoryOptions } from "./options-schema";

export interface PlanStoryChapterView {
  chapterId: ChapterId;
  title: string;
  /** Read straight off the registry, never re-derived — `chapter-pdf.tsx`
   *  branches on it and a fifth spelling here would print the wrong page. */
  layout: ChapterLayout;
  /** Paragraphs, already resolved: advisor edit → generated → fallback. */
  paragraphs: string[];
  /** Strategy cards; empty for every layout except strategyCards. */
  strategies: Array<{ name: string; what: string; detail: string }>;
  /** The figure cards beside a `twoUp` chapter's prose; empty for every other
   *  layout. */
  figures: Array<{ label: string; value: string }>;
  /** The numbered next steps of a `checklist` chapter; empty for every other
   *  layout. */
  steps: Array<{ text: string; owner: string; when: string }>;
  /** The client-facing sentence that replaces what a sheet could not hold.
   *  "" means nothing was dropped. */
  overflowNote: string;
}

export interface PlanStoryPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  /**
   * What the empty-state page should say, or "" when there is nothing empty
   * about it. The two ways this page ends up with no chapters are not the same
   * thing and must not print the same sentence: an advisor who switched every
   * chapter off should be told so, and one whose story failed to load should
   * not be told they did something they didn't.
   */
  emptyMessage: string;
  chapters: PlanStoryChapterView[];
}

/** Injected by the export route when the deck contains a Plan Story page. */
export interface PlanStoryContextInput {
  story: StoryContext;
  /** chapterId → resolved text. Missing entries fall back deterministically. */
  text: Partial<Record<ChapterId, string>>;
}

const NO_STORY = "The plan story isn't available for this report.";
const NO_CHAPTERS = "No chapters are switched on for this report.";

const TITLE = "Your Plan";

/** A table's delimiter row (`|---|---|`) and the horizontal rules a model writes
 *  between sections. Neither carries a word, so both are dropped whole. */
const RULE_LINE_RE = /^[\s|:-]*-[\s|:-]*$/u;

/**
 * Markdown syntax, removed before it reaches the page.
 *
 * The system prompt asks the model for "clean Markdown" (chapters/prompts.ts)
 * and `chapter-pdf.tsx` renders each paragraph into a raw react-pdf `<Text>`, so
 * `##`, `**` and a table's pipes print to the client exactly as written. No gate
 * catches this — Gate 2 rejects only a NESTED heading — and this is the only
 * place that also covers the advisor's own `editedText`, which no gate ever sees.
 *
 * The character classes are the ones `validate/facts.ts#normalizeFigures` and
 * `validate/voice.ts#normalize` already fold for the same reason: emphasis is
 * decoration, not spelling.
 */
function stripMarkdown(paragraph: string): string {
  return paragraph
    .split(/\r?\n/u)
    .filter((line) => !RULE_LINE_RE.test(line))
    .map((line) =>
      line
        .replace(/^ {0,3}#{1,6}\s+/u, "") // heading
        .replace(/^\s*\|/u, "") // a table row's outer pipes…
        .replace(/\|\s*$/u, "")
        .replace(/\s*\|\s*/gu, " · ") // …and the separators between its cells
        .replace(/[*_`]/gu, "") // emphasis and code ticks
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Blank lines separate paragraphs; a single newline is a line break inside one. */
function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/u).map(stripMarkdown).filter(Boolean);
}

/**
 * What one story sheet holds — and therefore what the page-count estimate is
 * ALLOWED to be right about.
 *
 * Why this has to exist: `estimatePlanStoryPageCount` reserves one sheet per
 * printed chapter from the options alone (`document.tsx` calls it with no data),
 * and `documentSections` takes the table of contents' start pages from that same
 * estimate. A chapter that renders onto a second sheet does not just look long —
 * it shifts every printed page after it away from the number the contents page
 * names. The estimate cannot be made a function of content without changing
 * every page's signature, so the RENDER is what gives way and the invariant
 * becomes true by construction.
 *
 * All four numbers below are MEASURED, by rendering real PDFs and reading the
 * page count back out of the page-tree node. They are deliberately plain
 * ceilings rather than a fitted model of the layout — a model was tried, and the
 * measurements will not support one:
 *
 *   · five paragraphs of 81 words (405 words) occupy one sheet, while twelve
 *     paragraphs of 27 (324 words) overflow — a paragraph costs its own bottom
 *     margin whether it holds four words or forty, so words alone cannot
 *     describe the page, and
 *   · ⚠️ `PageFrame` gives its body `flex: 1`, so react-pdf may CLIP content
 *     past the available height instead of breaking to a second sheet. A
 *     rendered page count of 1 therefore does not prove the prose survived, only
 *     that it did not paginate, and there is no cheap instrument for the
 *     difference (react-pdf embeds a subsetted font, so the text cannot be read
 *     back out of the PDF).
 *
 * So each ceiling sits at or inside something actually observed to lay out, and
 * `plan-story-render.test.tsx` re-runs those cases every suite.
 */

/** Cards, with nothing else on the sheet: four lay out, five render two sheets. */
export const MAX_STRATEGY_CARDS = 4;

/** Prose on a sheet carrying no cards: 300 words lay out, 360 overflow. */
export const SHEET_BUDGET_WORDS = 300;

/** …and on a sheet already carrying cards. Measured against the WORST case, the
 *  full set of four: four cards plus 81 words lay out, plus 162 overflow. */
const BUDGET_WORDS_WITH_CARDS = 80;

/**
 * What the figure column beside a `twoUp` chapter's prose holds.
 *
 * Eight cards lay out and nine spill, so the sheet is not what decides this —
 * five is an editorial ceiling. A page whose job is one idea stops being one at
 * a stack of eight numbers, and the prose column beside it is the taller of the
 * two long before the cards run out.
 */
export const MAX_FIGURE_CARDS = 5;

/**
 * …and what the prose in a `twoUp` chapter may spend.
 *
 * A little over half what a heroProse chapter gets, and not because the sheet is
 * fuller: the figure column takes 170pt plus its gap out of the text measure, so
 * the prose runs at roughly two thirds the width and the same words cost half
 * again as many LINES. A budget shared with `heroProse` would overflow every
 * twoUp chapter while measuring as if it fit.
 *
 * Measured on the SHIPPING path, with the trim note printed and a full figure
 * column beside it, across three paragraph shapes: 140 words lay out in all of
 * them and 150 spills at 21 words a paragraph. Line count is what actually runs
 * out — eight paragraphs of 21 words wrap to four lines each and waste most of
 * the fourth — so this sits inside the shortest observed fit rather than at it.
 *
 * ⚠️ It is genuinely short: about two paragraphs. A twoUp chapter's prompt has
 * to ask for less prose than a heroProse chapter's, or the trim note becomes the
 * normal ending rather than the exception.
 */
const BUDGET_WORDS_TWO_UP = 130;

/**
 * The next steps a `checklist` chapter prints before the sheet runs out.
 *
 * Measured on the shipping path against the worst step a household can produce —
 * text that wraps to two lines, with an owner and a date under it: eight lay out
 * and ten do not. Eight is also about as many as a client will act on.
 *
 * What is dropped is said, not hidden — the same `overflowNote` the strategy
 * cards use, and for the same reason: a list that silently stops reads as the
 * whole list.
 */
export const MAX_STEPS = 8;

/**
 * …and what the lead paragraph above that list may spend.
 *
 * The steps ARE the chapter; the prose is a sentence of lead-in. Measured beside
 * a full set of eight worst-case steps and the trim note: 40 words lay out and
 * 45 spill, so this sits inside that. With six or seven steps the same sheet
 * takes 55 and more — the two bounds are not independent, and this one is set
 * for the case where both are at their limit.
 */
const BUDGET_WORDS_CHECKLIST = 35;

/**
 * A ceiling on paragraph COUNT as well, because the word ceiling alone cannot
 * see the shape that actually costs the most: 300 words split into sixty
 * four-word paragraphs pays sixty bottom margins. Eleven paragraphs were
 * measured to lay out; this sits comfortably inside that.
 */
const MAX_PARAGRAPHS = 8;

function proseBudgetWords(layout: ChapterLayout, cards: number): number {
  if (layout === "twoUp") return BUDGET_WORDS_TWO_UP;
  if (layout === "checklist") return BUDGET_WORDS_CHECKLIST;
  return cards > 0 ? BUDGET_WORDS_WITH_CARDS : SHEET_BUDGET_WORDS;
}

/** "…and four more changes we'll walk through together." — the sentence that
 *  replaces what a sheet cannot hold. Client-facing, and true: it says the
 *  changes exist and that the advisor will cover them, rather than implying the
 *  report is complete. One sentence for both capped lists, because a list that
 *  silently stops reads as the whole list either way. */
function overflowNoteFor(dropped: number, thing: "change" | "step"): string {
  if (dropped <= 0) return "";
  return dropped === 1
    ? `…and one more ${thing} we'll walk through together.`
    : `…and ${dropped} more ${thing}s we'll walk through together.`;
}

const PROSE_TRIMMED_NOTE =
  "…there's more here than fits this page — we'll walk through the rest together.";

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/** Everything before the first occurrence of `phrase`, plus everything after it. */
function strikeFirst(text: string, phrase: string): string {
  if (phrase.length === 0) return text;
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  return at < 0 ? text : text.slice(0, at) + text.slice(at + phrase.length);
}

const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * The figure cards beside a `twoUp` chapter's prose.
 *
 * Built from the chapter's OWN scoped facts, using each fact's own `label` and
 * `display` — the same two strings the prompt showed the model. That is what
 * makes the card and the paragraph beside it structurally incapable of
 * disagreeing about a number, and it is why the fact pack had to be scoped per
 * chapter first: an unscoped pack would put the headline figures on every
 * chapter's card stack as well as in every chapter's prose.
 *
 * The label prints as the card's caption — the one place a `Fact.label` IS
 * client-facing. Gate 5 forbids the model from writing one into a sentence;
 * printing it over its own figure is what the label was written for.
 *
 * A quoted fact is left out. Its label names one change and quotes the sentence
 * it came from ('Sell the rental — from "…$850k sale"'), which is background
 * for the model, not a caption a client should read.
 */
function figuresFor(facts: Fact[]): PlanStoryChapterView["figures"] {
  return facts
    .filter((f) => !f.id.startsWith("quoted."))
    .slice(0, MAX_FIGURE_CARDS)
    .map((f) => ({ label: f.label, value: f.display }));
}

/**
 * Does this paragraph say anything the card doesn't already say?
 *
 * On the AI-off path `narrateWhatWeRecommend` writes one sentence per strategy —
 * `"Delay Social Security — Claim age: 67 → 70."` — and `generateChapter` STORES
 * that sentence as the chapter's text, so by export time it arrives here as
 * prose, indistinguishable from an advisor's own. The card then repeats the same
 * name and the same clause, out of the same `quotableDetail` call on the same
 * facts. Printing both puts the identical sentence on a client's page twice.
 *
 * The card is the richer of the two — it also carries WHAT WE'D DO — so the
 * PARAGRAPH is what goes, and only when it is a pure restatement: strike the
 * strategy's name and its quoted clause out of the sentence and drop it only if
 * nothing but punctuation is left. A lead-in that opens with the strategy's name
 * and then says something of its own keeps every word.
 *
 * Lives HERE rather than in `chapter-pdf.tsx`, where it used to, because the
 * sheet budget is spent on what actually prints: a paragraph the renderer was
 * always going to discard must not be charged for, or a chapter with a full set
 * of cards announces dropped prose that nobody ever lost.
 */

function restatesCard(paragraph: string, strategy: PlanStoryChapterView["strategies"][number]): boolean {
  if (strategy.name.length === 0) return false;
  const withoutName = strikeFirst(paragraph, strategy.name);
  if (withoutName === paragraph) return false;
  return !WORDLIKE.test(strikeFirst(withoutName, strategy.detail));
}

/**
 * Cut one paragraph down to `budget` words at a SENTENCE boundary.
 *
 * Reached only when the chapter's very first paragraph is already over budget —
 * an advisor pasting a wall of text into a box that accepts 20,000 characters.
 * Keeping it whole would break the one-sheet invariant, and dropping it would
 * blank the chapter, which is the outcome the renderer is built to make
 * impossible. So it is cut, and the note says so.
 *
 * At least one sentence always survives: a lone sentence longer than the budget
 * is hard-cut at the word count rather than thrown away.
 */
function truncateToBudget(paragraph: string, budget: number): string {
  const kept: string[] = [];
  let words = 0;
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/u)) {
    const n = wordCount(sentence);
    if (kept.length > 0 && words + n > budget) break;
    kept.push(sentence);
    words += n;
  }
  const text = kept.join(" ");
  return words > budget ? text.split(/\s+/u).filter(Boolean).slice(0, budget).join(" ") : text;
}

/**
 * Trim the prose to the lines the sheet has left after the cards.
 *
 * Paragraph-granular wherever it can be: cutting mid-thought on a client page is
 * worse than one paragraph fewer.
 */
function capParagraphs(paragraphs: string[], budget: number): { kept: string[]; trimmed: boolean } {
  const kept: string[] = [];
  let words = 0;
  for (const p of paragraphs) {
    const n = wordCount(p);
    if (kept.length > 0 && (words + n > budget || kept.length >= MAX_PARAGRAPHS)) {
      return { kept, trimmed: true };
    }
    if (kept.length === 0 && n > budget) return { kept: [truncateToBudget(p, budget)], trimmed: true };
    kept.push(p);
    words += n;
  }
  return { kept, trimmed: false };
}

export function buildPlanStoryData(
  ctx: BuildDataContext,
  options: PlanStoryOptions,
): PlanStoryPageData {
  const input = ctx.planStory;
  // Options only, exactly as `estimatePlanStoryPageCount` counted them. Filtering
  // again here on `input.story.hasProposal` would reintroduce the possibility of
  // rendering a different number of pages than the deck was numbered for; the two
  // agree by construction because the export loader derives the story's
  // `hasProposal` from this same `scenarioId`.
  const ids = printedChapters(options);

  if (!input || ids.length === 0) {
    return {
      title: TITLE,
      // Nothing narrated, so there is no prose for the deck's own label to
      // contradict — and when the story is missing entirely, it is the only
      // label there is.
      subtitle: input?.story.scenarioLabel ?? ctx.scenarioLabel,
      isEmpty: true,
      emptyMessage: input ? NO_CHAPTERS : NO_STORY,
      chapters: [],
    };
  }

  const chapters: PlanStoryChapterView[] = ids.map((chapterId) => {
    const def = CHAPTERS[chapterId];
    // Scoped exactly as `generate.ts` scopes it before calling the same
    // narrator. Unscoped, the PDF's fallback could print a figure the review
    // panel's copy of that chapter never showed the advisor.
    const facts = factsForChapter(input.story.facts, chapterId);
    const stored = input.text[chapterId];
    const paragraphs =
      stored && stored.trim().length > 0
        ? splitParagraphs(stored)
        : def.narrate({ ...input.story, facts });

    const allStrategies =
      def.layout === "strategyCards"
        ? input.story.strategies.map((s) => ({
            name: s.name,
            what: s.rows.map((r) => r.what).join(", "),
            // NOT the raw `detail[0]`. That field is written by the Scenario
            // Changes table in its own rounding and its own case, and nothing in
            // it is in the fact pack unless we put it there — so it goes through
            // the same gate the chapter's prose goes through, and a clause that
            // fails leaves the card without a "what it does" line rather than
            // with a borrowed figure.
            detail: quotableDetail(s.rows[0]?.detail[0], facts) ?? "",
          }))
        : [];
    const strategies = allStrategies.slice(0, MAX_STRATEGY_CARDS);
    const figures = def.layout === "twoUp" ? figuresFor(facts) : [];
    const allSteps = def.layout === "checklist" ? (input.story.nextSteps ?? []) : [];
    const steps = allSteps.slice(0, MAX_STEPS);
    // Discard what the cards already say BEFORE counting, so the budget is spent
    // on what a client will actually read.
    const printable = paragraphs.filter((p) => !strategies.some((s) => restatesCard(p, s)));
    // The cards are charged against the sheet first — on the one chapter that
    // has them they ARE the content, and the prose is a lead-in. What is left
    // is what the prose may spend.
    const { kept, trimmed } = capParagraphs(
      printable,
      proseBudgetWords(def.layout, strategies.length),
    );

    return {
      chapterId,
      title: def.title,
      layout: def.layout,
      paragraphs: kept,
      strategies,
      figures,
      steps,
      // ONE note, whichever bound bit. Both mean the same thing to the reader —
      // there is more, and the advisor will cover it — and two notes on one
      // sheet would be the overflow this cap exists to prevent. The card count
      // leads because it is the specific one: it can say how many.
      overflowNote:
        overflowNoteFor(allStrategies.length - strategies.length, "change") ||
        overflowNoteFor(allSteps.length - steps.length, "step") ||
        (trimmed ? PROSE_TRIMMED_NOTE : ""),
    };
  });

  return {
    title: TITLE,
    // The story's label, NOT `ctx.scenarioLabel`. The deck's per-page override
    // drives `ctx.scenarioLabel` while `options.scenarioId` drives the prose, so
    // an advisor can point the override at the proposal and leave the story on
    // base — which would head this page "Proposed" over Base Case prose. A page
    // that names a plan it did not narrate is worse than one whose heading
    // differs from its neighbours'.
    subtitle: input.story.scenarioLabel,
    isEmpty: false,
    emptyMessage: "",
    chapters,
  };
}
