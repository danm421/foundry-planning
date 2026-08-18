// Export does NO LLM work. Chapter prose is read from storage by the export
// route and threaded in via `BuildDataContext.planStory`; this builder only
// decides what renders and supplies the deterministic fallback for anything that
// was never generated.
import type { BuildDataContext } from "@/components/presentations/registry";
import type { EstateSummaryChartBar } from "@/lib/presentations/pages/estate-summary/view-model";
import { fmtUsdCompact } from "@/lib/presentations/pages/retirement-comparison/format";
import type { PortfolioBar } from "@/lib/presentations/pages/retirement-summary/aggregate";
import type { TaxYearBar } from "@/lib/presentations/pages/tax-summary/aggregate";
import { CHAPTERS, type ChapterLayout } from "@/lib/presentations/story/chapters/registry";
import { quotableDetail, usableName } from "@/lib/presentations/story/chapters/what-we-recommend";
import type { StoryChartData } from "@/lib/presentations/story/charts";
import type { Fact } from "@/lib/presentations/story/facts";
import { GLOSSARY, type GlossaryTerm } from "@/lib/presentations/story/glossary";
import {
  factsForChapter,
  type ChapterId,
  type StoryContext,
  type StoryStep,
} from "@/lib/presentations/story/types";
import { printedChapters, type PlanStoryOptions } from "./options-schema";
// Its own module so the review panel — a client component — can split the same
// way without pulling this file into its bundle. Measured: `story/glossary` and
// `./options-schema` are the two modules that would genuinely be new there; see
// `paragraphs.ts` for the rest of the count.
import { splitParagraphs } from "./paragraphs";

/**
 * The chart printed above a `chartWithProse` chapter's prose.
 *
 * A discriminated union rather than a bag of optional arrays, so
 * `chapter-chart-pdf.tsx` can `switch` with no `default` and a fourth chart is
 * a compile error there rather than a blank space on a client's page.
 *
 * Each variant carries THE ARRAY, passed through from `StoryContext.charts` —
 * never a copy and never a re-derivation. `story/charts.ts` says why.
 */
export type PlanStoryChart =
  | { kind: "portfolioBars"; bars: PortfolioBar[]; retirementYear: number }
  | { kind: "taxBars"; bars: TaxYearBar[] }
  | { kind: "estateBars"; bars: EstateSummaryChartBar[]; totals: string[] };

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
   *  layout. The story's own shape, not a second copy of it — these print the
   *  advisor's words unaltered and this page is where that promise is kept. */
  steps: StoryStep[];
  /**
   * The plain-English terms under a `glossary` chapter's prose; empty for every
   * other layout.
   *
   * A STRUCTURED field rather than prose, which is the whole point of it: the
   * export prefers stored text over the narrator, so anything written into the
   * chapter's paragraphs is replaced the first time an advisor hits Generate.
   * The model is asked for two short paragraphs and will never write eleven
   * definitions back, so a prose glossary would print only on the decks nobody
   * generated. Same shape as `steps` and `figures`, for the same reason.
   */
  glossary: GlossaryTerm[];
  /**
   * The chart printed above a `chartWithProse` chapter's prose.
   *
   * Null when this layout prints no chart, or when the household's data produced
   * none — see spec §7. The two are deliberately the same value: a chapter whose
   * arrays came back empty prints its prose alone rather than an empty axis, and
   * the renderer has one question to ask rather than two.
   */
  chart: PlanStoryChart | null;
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
 * Every number below sits at or inside a MEASURED bound, taken by rendering real
 * PDFs. That is not the same as the sheet having CHOSEN it: `MAX_FIGURE_CARDS`
 * stops at five on a sheet measured to hold eight, for a reason its own note
 * gives. So a bound never licenses raising one of these on its own — read the
 * constant's note first.
 *
 * They are deliberately plain ceilings rather than a fitted model of the layout
 * — a model was tried, and the measurements will not support one:
 *
 *   · five paragraphs of 81 words (405 words) occupy one sheet, while twelve
 *     paragraphs of 27 (324 words) overflow — a paragraph costs its own bottom
 *     margin whether it holds four words or forty, so words alone cannot
 *     describe the page, and
 *   · ⚠️ `PageFrame` gives its body `flex: 1`, so react-pdf may CLIP content
 *     past the available height instead of breaking to a second sheet. A
 *     rendered page count of 1 therefore does not prove the prose survived, only
 *     that it did not paginate.
 *
 * Which instrument each ceiling was taken with matters, and they are not the
 * same one. The ones above `BUDGET_WORDS_CHART` were read off the page-tree
 * node's `/Count` — a bound a clipped sheet can satisfy, which is why they sit
 * INSIDE what was observed rather than at it. The chart pair was read off the
 * geometry itself: `pdftotext -bbox` gives every word's box back, so the lowest
 * word on the sheet can be compared against the 720pt line where `PageFrame`
 * reserves its footer.
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
 * …and how many PARAGRAPHS that 80 words may be spread across.
 *
 * `MAX_PARAGRAPHS` was measured on a sheet carrying no cards. A paragraph costs
 * its own bottom margin whether it holds four words or forty — the note above
 * `MAX_STRATEGY_CARDS` says so — and the AI-off narrator for this one chapter
 * writes one ~10-word paragraph PER STRATEGY. Eleven strategies leave seven
 * paragraphs after `restatesCard` drops the four that repeat their cards: 70
 * words, inside the word budget, inside the eight-paragraph ceiling, and two
 * sheets. Measured on Cooper 2026-08-14 — the story reserved 14 and printed 15.
 *
 * Three is measured, not chosen: four cards beside three short paragraphs lay
 * out, four spill. `plan-story-render.test.tsx` re-runs both every suite.
 */
export const MAX_PARAGRAPHS_WITH_CARDS = 3;

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
 * The plain-English terms a `glossary` chapter prints before the sheet runs out.
 *
 * Measured beside the full prose budget and the trim note, in the WORST shape
 * that budget allows — `MAX_PARAGRAPHS` short paragraphs rather than two long
 * ones, since a paragraph costs its own bottom margin whichever it is: twelve
 * terms lay out and thirteen spill. (At two or three paragraphs of prose, which
 * is what the narrator and the prompt actually produce, fourteen still fit — the
 * cap is set for the case a 20,000-character advisor edit can reach.)
 *
 * ⚠️ This list is OURS, not a household's — it grows when someone adds a word to
 * `glossary.ts`, on every client's report at once. The cap is what stops that
 * edit from silently adding a second sheet and mis-numbering the rest of the
 * deck; what it drops is said in the same `overflowNote` the steps use, and
 * `glossary.test.ts` goes red at the same time so the edit is re-measured rather
 * than quietly truncated.
 */
export const MAX_GLOSSARY_TERMS = 12;

/**
 * …and what the prose above that list may spend.
 *
 * The terms ARE the chapter — the prose is the assumptions and the one
 * invitation to ask, which the narrator writes in about 60 words. Measured
 * beside a full set of terms and the trim note: 90 words lay out in every
 * paragraph shape, and what runs out past that is LINES, not words — thirteen
 * terms spill at 60 words just as they do at 90.
 */
export const BUDGET_WORDS_GLOSSARY = 90;

/**
 * A ceiling on paragraph COUNT as well, because the word ceiling alone cannot
 * see the shape that actually costs the most: 300 words split into sixty
 * four-word paragraphs pays sixty bottom margins. Eleven paragraphs were
 * measured to lay out; this sits comfortably inside that.
 */
export const MAX_PARAGRAPHS = 8;

/**
 * …and what the prose UNDER a chart may spend.
 *
 * Half what a sheet carrying nothing above its prose gets, and the chart is the
 * whole of the difference: the tallest of the three — the portfolio chart and
 * the tax chart, each a 150pt `Svg` over a legend row — pushes the first line of
 * prose 186pt down the sheet. (The estate chart is 62pt shorter and has room
 * these two do not; the budget is one number for all three, so it is set for the
 * tall pair.)
 *
 * ⚠️ Measured by RENDERING the sheet and reading the bottom of its lowest word
 * back out with `pdftotext -bbox`, against the 720pt line where `PageFrame`
 * reserves its footer — a 792pt page less the 72pt of bottom padding that band
 * costs. A page COUNT cannot answer this question and must not be read as
 * though it had: `PageFrame` gives its body `flex: 1`, so "one sheet" is what a
 * sheet that fits and a sheet that clips both report.
 *
 * On the worst shape the two ceilings here allow — `MAX_PARAGRAPHS_CHART`
 * paragraphs, all but the last one word past a line break and wasting the rest
 * of it, with the trim note printed under them — 195 words lay out with their
 * lowest word's foot at 712pt and 200 render onto a second sheet. This sits two
 * lines inside that: 150 words come to 676pt.
 */
export const BUDGET_WORDS_CHART = 150;

/**
 * …and how many PARAGRAPHS those words may be spread across.
 *
 * The word ceiling alone cannot describe this sheet — a paragraph costs its own
 * bottom margin whether it holds four words or forty, which is the finding the
 * note above `MAX_STRATEGY_CARDS` records — and here the chart has already spent
 * 186pt before the first paragraph starts.
 *
 * Measured the same way, at the full word budget with the trim note printed: six
 * paragraphs lay out with their lowest word at 705pt, and seven render onto a
 * second sheet. Five is one paragraph inside that, and the layout's prompt asks
 * the model for two.
 */
export const MAX_PARAGRAPHS_CHART = 5;

/**
 * A `switch` with no `default`, so a seventh layout is a COMPILE error here
 * rather than a silent 300-word budget.
 *
 * That default is the one this file exists to prevent: a layout printing
 * something under its prose, handed a full sheet's words, renders onto a second
 * sheet — and `estimatePlanStoryPageCount` reserved one, so the contents page
 * mis-numbers everything after the story. The renderer's own layout branch is
 * held to the same question by `chapters/__tests__/registry.test.ts`, which
 * cannot be a type because the fall-through there is a valid page.
 */
function proseBudgetWords(layout: ChapterLayout, cards: number): number {
  switch (layout) {
    case "twoUp":
      return BUDGET_WORDS_TWO_UP;
    case "checklist":
      return BUDGET_WORDS_CHECKLIST;
    case "glossary":
      return BUDGET_WORDS_GLOSSARY;
    case "chartWithProse":
      return BUDGET_WORDS_CHART;
    case "heroProse":
    case "strategyCards":
      return cards > 0 ? BUDGET_WORDS_WITH_CARDS : SHEET_BUDGET_WORDS;
  }
}

/**
 * The paragraph ceiling, by layout. A `switch` with no `default` for the same
 * reason `proseBudgetWords` has none: a new layout must answer this question
 * rather than inherit an eight-paragraph ceiling measured on a sheet that
 * carries nothing under its prose.
 */
function proseParagraphCap(layout: ChapterLayout, cards: number): number {
  switch (layout) {
    case "twoUp":
    case "checklist":
    case "glossary":
      return MAX_PARAGRAPHS;
    case "chartWithProse":
      // NOT `MAX_PARAGRAPHS`, which was measured on a sheet carrying nothing
      // above its prose. See `MAX_PARAGRAPHS_CHART`.
      return MAX_PARAGRAPHS_CHART;
    case "heroProse":
    case "strategyCards":
      return cards > 0 ? MAX_PARAGRAPHS_WITH_CARDS : MAX_PARAGRAPHS;
  }
}

/** "…and four more changes we'll walk through together." — the sentence that
 *  replaces what a sheet cannot hold. Client-facing, and true: it says the
 *  changes exist and that the advisor will cover them, rather than implying the
 *  report is complete. One sentence for every capped list — the cards, the
 *  steps, the glossary — because a list that silently stops reads as the whole
 *  list whichever list it is. */
function overflowNoteFor(dropped: number, thing: "change" | "step" | "term"): string {
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
 * The year the portfolio chart draws its retirement marker on.
 *
 * Read back off the fact pack rather than threaded in separately, because the
 * pack is the only place this builder can reach it and re-deriving it would mean
 * a second `DOB year + retirementAge` (`load-context.ts`) that agrees today.
 * `build-facts.ts` emits `plan.retirementYear` with NO `chapters` scope, so it
 * survives `factsForChapter` onto every chapter.
 *
 * Zero when the pack has none, which is the already-retired household:
 * `build-facts.ts` only emits the fact when the retirement year is at or after
 * the plan's start year. No bar carries year 0, so the chart draws no marker —
 * the same answer `chartFacts` gives when it drops `chart.portfolio.atRetirement`
 * for that household.
 */
function retirementYearFrom(facts: Fact[]): number {
  return facts.find((f) => f.id === "plan.retirementYear")?.raw ?? 0;
}

/**
 * The chart this chapter prints, or null.
 *
 * Keyed on the CHAPTER, not the layout: the layout says a chart goes here, and
 * only the chapter says which one.
 *
 * ⚠️⚠️ This list must stay in step with the chapter scopes
 * `build-facts.ts#chartFacts` gives the matching `chart.*` facts
 * (`PORTFOLIO_CHART_CHAPTERS`, `TAX_CHART_CHAPTERS`), and the failure mode of
 * drift is SILENCE rather than a rejection. `generate.ts:270` scopes the pack
 * once with `factsForChapter` and `generate.ts:411` judges the draft against
 * that same scoped array, so `chart-citation.ts:21-25` sees only the chapter's
 * own facts and returns `[]` the moment none of them is a `chart.` one. Draw a
 * chart on a chapter those facts do not reach and Gate 8 does not fire, does not
 * retry, and says nothing: the sheet ships a picture the prose was never
 * required to mention. Nothing else in the report notices — the gate's empty
 * return is also the legitimate no-chart path, which is what makes the two
 * indistinguishable from the outside.
 *
 * ⚠️ `whatsLeftForPeople` is already that shape: `chartFacts` emits `chart.*`
 * facts for the portfolio and tax charts only, and none for the estate one. The
 * estate branch below returns a chart only once something hands
 * `StoryChartData.estate` real bars rather than the null that field documents as
 * the ordinary answer for a deck with no estate report — so the mismatch costs
 * nothing until something does, and the moment something does, the sheet prints
 * a chart no gate will ever ask the prose to mention.
 *
 * An EMPTY array is null, never a chart: spec §7 — drop the chart, keep the
 * prose, and never print an axis with no bars on a client's page.
 */
function chartFor(chapterId: ChapterId, charts: StoryChartData | undefined, facts: Fact[]): PlanStoryChart | null {
  if (!charts) return null;
  switch (chapterId) {
    case "willTheMoneyLast":
      return charts.portfolio.length > 0
        ? {
            kind: "portfolioBars",
            bars: charts.portfolio,
            retirementYear: retirementYearFrom(facts),
          }
        : null;
    case "whatYoullPayInTax":
      return charts.tax.length > 0 ? { kind: "taxBars", bars: charts.tax } : null;
    case "whatsLeftForPeople":
      // The one chart of the three that prints money under its bars, so the
      // labels are pre-formatted HERE and threaded in. Its own `fmtUsd`
      // (`pages/estate-summary/aggregate.ts`) renders thousands with a lowercase
      // k — "$850k" — where `moneyFact` formats every figure in the pack with
      // `fmtUsdCompact`'s uppercase K. Left to the component, one sheet would
      // print two spellings of one number. `validate/facts.ts#figureKey`
      // uppercases before comparing, so Gate 1 could never have caught it.
      return charts.estate && charts.estate.bars.length > 0
        ? {
            kind: "estateBars",
            bars: charts.estate.bars,
            totals: charts.estate.bars.map((b) => fmtUsdCompact(b.total)),
          }
        : null;
    default:
      return null;
  }
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
 * A card with nothing in any of its three fields is not a card, and a bordered
 * box with nothing inside it reads as a rendering failure.
 *
 * Each field is refused independently and each refusal is reachable on its own:
 * `usableName` blanks a name carrying the changes table's machine text or
 * running past 48 characters, and `quotableDetail` refuses a `what` or a
 * `detail` whose figures the fact pack does not hold.
 *
 * ⚠️ Honest limit: the three firing at once is a possible state, not an observed
 * one. Every shape traced keeps one field — a savings-rule EDIT keeps
 * `"on <account>"` as its detail, and a savings-rule ADD has its own figures
 * admitted to the pack from `detail[0]`, so its `what` grounds. It is one line
 * that removes the state, not a fix for a sighting.
 *
 * ⭐ Lives HERE and not in `chapter-pdf.tsx` for the reason `restatesCard` above
 * states: the sheet budget is spent on what actually prints. Filtering in the
 * renderer cost three real things, all of them measured — a card the renderer
 * always drops still took a `MAX_STRATEGY_CARDS` slot and displaced a real one;
 * `proseBudgetWords` trimmed prose to make room for a box never drawn; and the
 * dropped card fell out of `overflowNoteFor`'s arithmetic, so a change left the
 * client's report announced by nothing. Filtered before the slice, all three go
 * away and the note counts it — which is right: the change exists and the
 * advisor will cover it, which is exactly what that sentence says.
 */
function isEmptyCard(card: PlanStoryChapterView["strategies"][number]): boolean {
  return card.name.length === 0 && card.what.length === 0 && card.detail.length === 0;
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
function capParagraphs(
  paragraphs: string[],
  budget: number,
  maxParagraphs: number,
): { kept: string[]; trimmed: boolean } {
  const kept: string[] = [];
  let words = 0;
  for (const p of paragraphs) {
    const n = wordCount(p);
    if (kept.length > 0 && (words + n > budget || kept.length >= maxParagraphs)) {
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
            // The prose refuses the same machine text (`what-we-recommend.ts`
            // `describe`) for a reason that applies here just as much: this card
            // sits beside that prose on the same sheet, so a name refused in one
            // place and printed in the other is the same leak in a nicer font.
            name: usableName(s.name) ? s.name : "",
            // …and `what` through the SAME refusal `detail` goes through, one
            // row at a time. It is not the advisor's typing: a savings rule has
            // no name of its own, so `describeChangeTarget` builds one out of
            // the account plus a formatted basis ("401(k) · $15k/yr",
            // "401(k) · 6% of salary" — both pinned in
            // `lib/scenario/describe-change-target.test.ts`) and
            // `describe/kinds/savings.ts` puts it straight into this field. A
            // figure there is the changes table's rounding and case, and is in
            // the pack only if something else put it there.
            //
            // Per ROW rather than over the joined string, so one refused change
            // does not silence the ones beside it. Every row refused leaves ""
            // — the same answer `detail` gives, and `chapter-pdf.tsx` drops the
            // heading with it rather than printing a label over nothing.
            //
            // ⚠️ It does NOT rescue the card's NAME, which `usableName` blanks
            // independently and for a different reason. The modal outcome for an
            // ungrouped savings-rule EDIT is therefore a card with a blank name
            // line printing one line — "WHAT IT DOES / on 401(k)" — not a card
            // that merely lost its "what we'd do". The nameless card predates
            // this refusal; see `future-work/reports.md`.
            what: s.rows
              .map((r) => quotableDetail(r.what, facts))
              .filter((w): w is string => w !== null)
              .join(", "),
            // NOT the raw `detail[0]`. That field is written by the Scenario
            // Changes table in its own rounding and its own case, and nothing in
            // it is in the fact pack unless we put it there — so it goes through
            // the same gate the chapter's prose goes through, and a clause that
            // fails leaves the card without a "what it does" line rather than
            // with a borrowed figure.
            detail: quotableDetail(s.rows[0]?.detail[0], facts) ?? "",
          }))
        : [];
    // Empty cards out BEFORE the slice, so one never displaces a card that would
    // have printed. `allStrategies` keeps them, which is what leaves them inside
    // the overflow note's arithmetic below.
    const strategies = allStrategies.filter((s) => !isEmptyCard(s)).slice(0, MAX_STRATEGY_CARDS);
    const figures = def.layout === "twoUp" ? figuresFor(facts) : [];
    const allSteps = def.layout === "checklist" ? (input.story.nextSteps ?? []) : [];
    const steps = allSteps.slice(0, MAX_STEPS);
    // Not a household's data and not the story's — the same eleven terms on
    // every report, read from the module the gates' ban list is pinned against.
    const allTerms = def.layout === "glossary" ? GLOSSARY : [];
    const glossary = allTerms.slice(0, MAX_GLOSSARY_TERMS);
    // Discard what the cards already say BEFORE counting, so the budget is spent
    // on what a client will actually read.
    const printable = paragraphs.filter((p) => !strategies.some((s) => restatesCard(p, s)));
    // The cards are charged against the sheet first — on the one chapter that
    // has them they ARE the content, and the prose is a lead-in. What is left
    // is what the prose may spend.
    const { kept, trimmed } = capParagraphs(
      printable,
      proseBudgetWords(def.layout, strategies.length),
      proseParagraphCap(def.layout, strategies.length),
    );

    return {
      chapterId,
      title: def.title,
      layout: def.layout,
      paragraphs: kept,
      strategies,
      figures,
      steps,
      glossary,
      chart: chartFor(chapterId, input.story.charts, facts),
      // ONE note, whichever bound bit. They all mean the same thing to the
      // reader — there is more, and the advisor will cover it — and two notes on
      // one sheet would be the overflow these caps exist to prevent. The counted
      // lists lead because they are the specific ones: they can say how many.
      // Only one can ever be non-zero, since each is scoped to its own layout.
      overflowNote:
        // `allStrategies`, NOT the filtered list — an empty card is a change the
        // report cannot describe, and this sentence is what says the advisor
        // will cover it. Counting the filtered list instead would drop it out of
        // the report entirely, announced by nothing.
        overflowNoteFor(allStrategies.length - strategies.length, "change") ||
        overflowNoteFor(allSteps.length - steps.length, "step") ||
        overflowNoteFor(allTerms.length - glossary.length, "term") ||
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
