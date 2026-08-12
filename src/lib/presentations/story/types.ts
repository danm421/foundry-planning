import type { ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import type { Fact } from "./facts";

/** Plan 1 ships three of the spec's fourteen chapters. Extend this union — and
 *  CHAPTER_IDS below — as Plan 2 lands the rest. */
export type ChapterId = "planInOnePage" | "whatYouHave" | "whatWeRecommend";

export const CHAPTER_IDS: readonly ChapterId[] = [
  "planInOnePage",
  "whatYouHave",
  "whatWeRecommend",
] as const;

export interface StoryHousehold {
  /** "Alan and Teresa" — used sparingly in the prose. */
  firstNames: string;
  /** "the Bradshaw household" — used once, for framing. */
  householdName: string;
}

/** One toggle group's worth of scenario edits, presented as a single idea. */
export interface StoryStrategy {
  name: string;
  rows: ChangeRow[];
}

export interface StoryContext {
  household: StoryHousehold;
  scenarioLabel: string;
  /** Switches the prose between self-contained and pointing at the pages after. */
  documentRole: "standalone" | "frontMatter";
  /** False for a no-changes annual review — the recommendation chapters hide. */
  hasProposal: boolean;
  strategies: StoryStrategy[];
  facts: Fact[];
}

/**
 * The figures one chapter may use — the pack minus anything scoped to other
 * chapters. A fact with no `chapters` is a plan-level total and belongs
 * everywhere.
 *
 * The single place that filter is written. What the model is SHOWN and what
 * Gate 1 ALLOWS have to be the same set: show a figure the gate will reject and
 * the chapter spends its one retry on a word we handed it, and allow a figure
 * the model was never shown and the scoping does nothing. `generate.ts` applies
 * this once, at the top, and everything downstream reads the result — so the
 * two sets are the same array rather than two filters that agree today.
 */
export function factsForChapter(facts: Fact[], chapterId: ChapterId): Fact[] {
  return facts.filter((f) => !f.chapters || f.chapters.includes(chapterId));
}

/** The whole fact, for the rare narrative that has to COMPARE two figures rather
 *  than print one. `raw` is the only safe way to do that: `display` is rounded
 *  for the page, so "91%" and "90.6%" can be the same string at one decimal. */
export function findFact(ctx: StoryContext, id: string): Fact | null {
  return ctx.facts.find((f) => f.id === id) ?? null;
}

/**
 * Look a fact up by id. Returns the pre-formatted display string, or null.
 * Narratives and prompts read figures through this, so nothing can put an
 * unformatted number on the page.
 *
 * One deliberate exception: `chapters/what-we-recommend.ts` quotes a
 * `ChangeRow.detail` written by another module. That text never passes through
 * here, so it is checked against the fact gate AND against the fact pack's
 * spellings before it is printed, and dropped when it fails either. Any future
 * chapter that quotes text it did not build owes the same check.
 */
export function factDisplay(ctx: StoryContext, id: string): string | null {
  return findFact(ctx, id)?.display ?? null;
}
