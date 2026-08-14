// The one chapter whose content the advisor writes: `plan_observations`
// next-step rows, with their `{{merge tokens}}` resolved against this plan.
//
// Its own module rather than another block inside `load-context.ts`, for the
// same reason `scenario-label.ts` is: this is a single scoped query with a
// mapping of its own, and the assembly in the loader is already the longest
// function in the story core.
//
// ⚠️ The mapping is NOT ours. `buildObservationsPageData` decides which rows are
// next steps, which are finished, what order they come in, how an owner is
// labelled and how a date is spelled — and it is the same call the deck's
// Observations & Next Steps page makes. Under `documentRole: "frontMatter"` both
// pages can sit a few leaves apart in one PDF, and two spellings of "Client ·
// March 1, 2026" inside one document is exactly what reusing that builder makes
// impossible.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { planObservations } from "@/db/schema";
import { buildObservationsPageData } from "@/lib/presentations/pages/observations-next-steps/view-model";
import {
  OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
  type ObservationsPageOptions,
} from "@/lib/presentations/pages/observations-next-steps/options-schema";
import { blocksToPlainText, type Block } from "@/lib/presentations/pages/blank/markdown-blocks";
import type { TokenContext } from "@/lib/plan-text/tokens";
import type { StoryStep } from "./types";

/**
 * What the story asks that builder for: the page's own defaults, with the two
 * fields this chapter has an opinion about spelled out.
 *
 * `include` is load-bearing — it gates the whole next-steps loop, not just the
 * topic groups — and every other default is inherited rather than retyped, so a
 * field this chapter does not care about cannot drift from the page's.
 *
 * `includeCompleted` matches that default today and is stated anyway, because it
 * is the STORY's call and not the page's: a step already done is not something
 * that happens next, whatever an advisor may later want the page itself to show.
 * (`topics: []`, inherited, is every topic — a chapter titled "What happens
 * next" that quietly dropped the tax items would be a list that reads as the
 * whole list.)
 */
const STORY_STEP_OPTIONS: ObservationsPageOptions = {
  ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
  include: "nextSteps",
  includeCompleted: false,
};

/**
 * The one line this step prints as.
 *
 * The TITLE first, because that field's own placeholder is "What needs to
 * happen" — it exists on next steps and nowhere else, and it is the advisor's
 * one-line version of exactly this. The body's first block stands in for a row
 * written without one.
 *
 * ⚠️ An editorial split, not a truncation: the detail under a step belongs to
 * the Observations & Next Steps page, which prints the whole body. This chapter
 * is a checklist — eight steps to a sheet, each measured at two lines — and a
 * three-paragraph body pasted into one of those rows overflows it.
 */
function stepText(title: string | null, bodyBlocks: Block[]): string {
  const titled = title?.trim() ?? "";
  // The words, not the markdown: the chapter prints each step as one line of
  // plain text (`chapter-pdf.tsx`), so a body that carried `**bold**` through
  // would print the asterisks.
  return titled.length > 0 ? titled : blocksToPlainText(bodyBlocks.slice(0, 1));
}

/**
 * Client-scoped, exactly as the three other reads of this table are. The rows
 * carry no cross-client data, and both callers of `loadStoryContext` have
 * already proven the caller may read this client.
 *
 * `tokens` resolve against the BASE plan, which is what the tokens are for:
 * "the year you stop working" is a fact about the household, and a next step
 * that changed its wording depending on which proposal happened to be in the
 * deck would be a different instruction on every export.
 */
export async function loadStoryNextSteps(clientId: string, tokens: TokenContext): Promise<StoryStep[]> {
  // The nine columns `ObservationsRowInput` reads, named — so the row IS that
  // input rather than something a hand-written adapter turns into it, and the
  // seven this chapter never looks at (ids, timestamps, `source`) stay out of
  // the result. `createdAt` orders the rows without being selected.
  const rows = await db
    .select({
      section: planObservations.section,
      topic: planObservations.topic,
      title: planObservations.title,
      body: planObservations.body,
      status: planObservations.status,
      owner: planObservations.owner,
      priority: planObservations.priority,
      targetDate: planObservations.targetDate,
      sortOrder: planObservations.sortOrder,
    })
    .from(planObservations)
    .where(and(eq(planObservations.clientId, clientId), eq(planObservations.section, "next_step")))
    // The tie-break the other three reads use. `buildObservationsPageData` sorts
    // on `sortOrder` itself, and a stable sort keeps this order inside a tie.
    .orderBy(asc(planObservations.sortOrder), asc(planObservations.createdAt));

  const { nextSteps } = buildObservationsPageData({ rows, ctx: tokens, options: STORY_STEP_OPTIONS });

  return nextSteps
    .map((step) => ({
      text: stepText(step.title, step.bodyBlocks),
      // "" rather than null: the layout joins whichever of the two it has, and
      // the narrator asks whether either is set.
      owner: step.ownerLabel ?? "",
      when: step.dateLabel ?? "",
    }))
    // A row with a title and a body is normal; a row with neither says nothing,
    // and a numbered blank line on a client's page is worse than one fewer step.
    .filter((step) => step.text.length > 0);
}
