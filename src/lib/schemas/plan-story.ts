import { z } from "zod";

/** Literal "base" or a scenario id. Whether the caller may actually key a story
 *  row on it is a per-client question, so it is answered by
 *  `resolveStoryScenarioId`, not here. */
const scenarioId = z.string().min(1).max(64).optional();

/**
 * One chapter's two advisor actions. Both fields are optional so a single PATCH
 * can save an edit, mark it reviewed, or do both — but a body carrying neither
 * is rejected by the route, since it would otherwise answer a no-op exactly
 * like a saved edit.
 *
 * An empty `editedText` is meaningful: it drops the advisor's version and lets
 * the model's words render again.
 */
export const planStoryChapterPatchSchema = z
  .object({
    scenarioId,
    // A chapter is a page of prose. The ceiling is roughly ten times the
    // longest one the narrators produce — headroom for an advisor who writes
    // long, and a bound on an otherwise unlimited write to a text column.
    editedText: z.string().max(20000).optional(),
    reviewed: z.boolean().optional(),
  })
  .strict();

/** One generation run over every chapter of one scenario. */
export const planStoryGenerateSchema = z
  .object({
    scenarioId,
    /** Whether the story stands alone or introduces the pages after it. */
    documentRole: z.enum(["standalone", "frontMatter"]).optional(),
    /** The panel's Regenerate action — bypass the 30-day AI cache. */
    force: z.boolean().optional(),
  })
  .strict();

export type PlanStoryChapterPatchInput = z.infer<typeof planStoryChapterPatchSchema>;
export type PlanStoryGenerateInput = z.infer<typeof planStoryGenerateSchema>;
