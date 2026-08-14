// Request shapes for the three story-voice routes. Everything an advisor can
// write into the voice tables passes through one of these.
import { z } from "zod";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";

/**
 * The bound BOTH voice texts carry, and the reason is the same one twice: every
 * character here is spent in the system prompt of all fourteen chapters, four
 * samples plus the note at a time. It is what keeps a generation affordable, and
 * it is a bound on two otherwise unlimited writes to `text` columns.
 *
 * 2,000 characters is roughly three paragraphs of guidance, and — at the
 * 6.3-6.9 characters per word this document's own prose runs to — about 290-315
 * words of sample. The longest chapter the narrators write is budgeted 300 words
 * (`chapters/registry.ts:304`), which is 1,890-2,070 characters at that rate: so
 * 2,000 sits INSIDE a full-length chapter's own range rather than above it. A
 * 300-word chapter of short words fits; one of long words runs about seventy
 * characters over and is refused. Room for a typical chapter, not a promise
 * about every one — `db/schema.ts` hedges it as "about one long chapter", and
 * that is the accurate reading.
 *
 * ⚠️ It is FAR below the 20,000 an advisor may write into a chapter
 * (`planStoryChapterPatchSchema.editedText`), so a harvest of a long edited
 * chapter is refused rather than truncated — the panel has to say so.
 */
export const VOICE_TEXT_MAX = 2000;

/**
 * The floor a sample has to clear, exported for the same reason as the ceiling:
 * a refusal that does not name the actual bound is a refusal with no visible
 * cause, and BOTH bounds are reachable from the harvest button — a long chapter
 * trips the ceiling, a chapter an advisor cut down to a line trips this.
 */
export const VOICE_TEXT_MIN = 20;

export const storyVoiceProfilePutSchema = z
  .object({
    styleNote: z.string().max(VOICE_TEXT_MAX),
    /** True to write the FIRM default rather than this advisor's own row.
     *  Admin-only; the route re-checks the role. */
    firmDefault: z.boolean().default(false),
  })
  .strict();

export const storyVoiceSamplePostSchema = z
  .object({
    /** The floor is there so a stray click cannot store "ok" as an exemplar of
     *  how someone writes. */
    text: z.string().min(VOICE_TEXT_MIN).max(VOICE_TEXT_MAX),
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
