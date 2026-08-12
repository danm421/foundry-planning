// Export does NO LLM work. Chapter prose is read from storage by the export
// route and threaded in via `BuildDataContext.planStory`; this builder only
// decides what renders and supplies the deterministic fallback for anything that
// was never generated.
import type { BuildDataContext } from "@/components/presentations/registry";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { quotableDetail } from "@/lib/presentations/story/chapters/what-we-recommend";
import { factsForChapter, type ChapterId, type StoryContext } from "@/lib/presentations/story/types";
import { printedChapters, type PlanStoryOptions } from "./options-schema";

export interface PlanStoryChapterView {
  chapterId: ChapterId;
  title: string;
  layout: "heroProse" | "strategyCards";
  /** Paragraphs, already resolved: advisor edit → generated → fallback. */
  paragraphs: string[];
  /** Strategy cards; empty for every layout except strategyCards. */
  strategies: Array<{ name: string; what: string; detail: string }>;
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

    const strategies =
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

    return { chapterId, title: def.title, layout: def.layout, paragraphs, strategies };
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
