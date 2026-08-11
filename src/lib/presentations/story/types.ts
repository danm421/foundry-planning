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

/** The whole fact, for the rare narrative that has to COMPARE two figures rather
 *  than print one. `raw` is the only safe way to do that: `display` is rounded
 *  for the page, so "91%" and "90.6%" can be the same string at one decimal. */
export function findFact(ctx: StoryContext, id: string): Fact | null {
  return ctx.facts.find((f) => f.id === id) ?? null;
}

/** Look a fact up by id. Returns the pre-formatted display string, or null.
 *  Every narrative and prompt reads figures through this, so nothing can put
 *  an unformatted number on the page. */
export function factDisplay(ctx: StoryContext, id: string): string | null {
  return findFact(ctx, id)?.display ?? null;
}
