// Request shapes for the three story-voice routes. Everything an advisor can
// write into the voice tables passes through one of these.
import { z } from "zod";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

/** Roughly three paragraphs. More guidance than a system prompt can absorb, and
 *  a bound on an otherwise unlimited write to a text column. */
export const storyVoiceProfilePutSchema = z
  .object({
    styleNote: z.string().max(2000),
    /** True to write the FIRM default rather than this advisor's own row.
     *  Admin-only; the route re-checks the role. */
    firmDefault: z.boolean().default(false),
  })
  .strict();

/** About two chapters of prose — an exemplar longer than that is a document,
 *  not a sample of a voice. */
export const storyVoiceSamplePostSchema = z
  .object({
    text: z.string().min(20).max(1200),
    /**
     * Checked against the live arc rather than stored blind. The column is free
     * text, so an unrecognised id would sit in a row the panel then labels with
     * a chapter this build does not have. Built FROM `CHAPTER_IDS`, so it cannot
     * drift from the union.
     */
    sourceChapterId: z.enum(CHAPTER_IDS).nullable().default(null),
    /** The household the text came from, and therefore the names the route
     *  scrubs out. Null for a sample the advisor typed themselves. */
    sourceClientId: z.string().uuid().nullable().default(null),
    /** As on the profile: admin-only, and the route re-checks the role. A firm
     *  sample is sent to the model on every colleague's reports. */
    firmDefault: z.boolean().default(false),
  })
  .strict();

/**
 * ⚠️ `text` is deliberately ABSENT, and `.strict()` turns a PATCH carrying it
 * into a 400 rather than a silent no-op an advisor would read as saved.
 *
 * Sample text reaches the table through POST and nowhere else, because POST is
 * where `scrubSample` runs — it is the only handler that resolves the source
 * household's names. An edit path would be a second write with nothing to scrub
 * against. Turning a sample off and writing a new one is how the words change.
 */
export const storyVoiceSamplePatchSchema = z.object({ enabled: z.boolean() }).strict();
