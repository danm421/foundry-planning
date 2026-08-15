import { z } from "zod";
import { chapterStyleSchema } from "@/lib/presentations/pages/plan-story/options-schema";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

/** Literal "base" or a scenario id. Whether the caller may actually key a story
 *  row on it is a per-client question, so it is answered by
 *  `resolveStoryScenarioId`, not here. */
const scenarioId = z.string().min(1).max(64).optional();

/**
 * Which register the words being written belong to. REQUIRED on both write
 * bodies, and deliberately not defaulted.
 *
 * Since 0240 the role is part of the row's key, so a default here would pick a
 * row to write on behalf of a caller that never said which one it meant — which
 * is indistinguishable from the bug the column was added to fix: the brief's
 * edits landing on the full story. A caller that does not know its own role is a
 * caller bug, and a 400 says so.
 *
 * The read path is the one place absence is allowed to mean "standalone": an
 * absent query parameter is an old client reading the pre-0240 rows, which is
 * exactly what the column default already says those rows are.
 */
const documentRole = z.enum(["standalone", "frontMatter"]);

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
    documentRole,
    // A chapter is a page of prose. The ceiling is roughly ten times the
    // longest one the narrators produce — headroom for an advisor who writes
    // long, and a bound on an otherwise unlimited write to a text column.
    editedText: z.string().max(20000).optional(),
    reviewed: z.boolean().optional(),
  })
  .strict();

/** One generation run over one scenario: every chapter it can supply, or the
 *  single one named. */
export const planStoryGenerateSchema = z
  .object({
    scenarioId,
    documentRole,
    /**
     * One chapter, from the panel's per-row Regenerate. Absent means the whole
     * story.
     *
     * `z.enum` over the real id list rather than a plain string: storage holds
     * `chapter_id` as free text, so an id this build does not know would be a
     * model call someone paid for written to a row nothing ever reads again. A
     * chapter retired from the arc is a 400 by construction here, rather than by
     * a second list that has to be remembered.
     */
    chapterId: z.enum(CHAPTER_IDS).optional(),
    /** The panel's Regenerate action — bypass the 30-day AI cache. */
    force: z.boolean().optional(),
    /**
     * How each chapter should be written — the deck's own per-chapter tone and
     * length, sent as saved. An input to every chapter's stored `sourceHash`, so
     * the staleness route takes the same map (as repeated query parameters, this
     * being a GET) and both fill their gaps through `resolveChapterStyles`.
     *
     * ⚠️ `partialRecord`, not `record`. The ordinary payload is PARTIAL — the
     * panel sends only the chapters an advisor has restyled — and `z.record`
     * over an enum key is EXHAUSTIVE in Zod 4, wanting all fourteen. Measured
     * both ways: it accepts a one-chapter map TODAY only because
     * `chapterStyleSchema` carries its own `.default`, which quietly fills the
     * other thirteen. That is a property of the ENTRY, not of the map — with a
     * non-defaulting entry the same expression fails a one-chapter map with
     * thirteen "expected object, received undefined" issues, while an ABSENT
     * field still passes on `.default({})`, so the break would not show until an
     * advisor changed a single tone. `partialRecord` says what is meant and does
     * not rest on the entry.
     *
     * Still an enum over the real id list, for the reason `chapterId` above is
     * one: an unknown key is a caller bug, and this map decides what a paid model
     * call is written in.
     *
     * The entry is the PAGE's schema, imported rather than restated: the panel
     * sends what the deck stored, so a second spelling could accept a tone the
     * deck cannot store, or refuse one it can.
     */
    chapterStyle: z.partialRecord(z.enum(CHAPTER_IDS), chapterStyleSchema).default({}),
  })
  .strict();

export type PlanStoryChapterPatchInput = z.infer<typeof planStoryChapterPatchSchema>;
export type PlanStoryGenerateInput = z.infer<typeof planStoryGenerateSchema>;
