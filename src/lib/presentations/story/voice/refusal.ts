// What an advisor is told when a sample is REFUSED rather than stored.
//
// Its own module because two surfaces need the identical sentence — the
// "write a sample" box in Settings → Voice, and "Save as a voice sample" on the
// Plan Story review panel — and because the harvest button is where a refusal is
// least expected: an advisor may write up to 20,000 characters into a chapter
// (`planStoryChapterPatchSchema.editedText`) and a stored sample stops at 2,000,
// so the FIRST long chapter anyone harvests comes back refused. A bare "couldn't
// save that" there is a failure with no visible cause.
//
// Truncation is deliberately not on offer. Storing 2,000 characters of a 5,000
// character chapter under the word "Saved" would misrepresent what the model is
// sent, and showing exactly what the model is sent is the whole point of this
// feature.
//
// Pure and framework-free: no fetch, no React, no DB. The caller does the
// request and hands the parsed body in.
import { VOICE_TEXT_MAX, VOICE_TEXT_MIN } from "@/lib/schemas/story-voice";

/** As `formatZodIssues` emits them (`lib/schemas/common.ts`). */
interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Did the server refuse this request because of THIS field — as opposed to a bad
 * chapter id, an unparseable body, or anything else that also lands as a 400?
 * Read off the issue list, because the status code alone cannot tell those apart.
 */
function fieldWasRefused(body: unknown, path: string): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { issues } = body as { issues?: unknown };
  if (!Array.isArray(issues)) return false;
  return (issues as unknown[]).some(
    (i) =>
      typeof i === "object" &&
      i !== null &&
      (i as Partial<ValidationIssue>).path === path,
  );
}

/** "2000" → "2,000". Pinned to en-US rather than the ambient locale so the
 *  sentence a test asserts on is the sentence an advisor reads. */
function commas(n: number): string {
  return n.toLocaleString("en-US");
}

/** One of the two prose fields an advisor writes, and everything that differs
 *  between their refusals. */
interface VoiceTextField {
  /** The `issues[].path` the route reports this field under. */
  path: string;
  /** How the sentence names it: "A voice sample can be at most…". */
  noun: string;
  /** What to do about it being too long. */
  tooLongRemedy: string;
  /**
   * The floor, and what to do about missing it — or NULL when the schema has
   * none. `storyVoiceProfilePutSchema.styleNote` is `.max()` with no `.min()`
   * (`schemas/story-voice.ts`), so a short style note saves fine and must never
   * be told otherwise.
   */
  floor: { min: number; remedy: string } | null;
}

const SAMPLE: VoiceTextField = {
  path: "text",
  noun: "A voice sample",
  tooLongRemedy: "Save a shorter passage — the part that sounds most like you.",
  floor: {
    min: VOICE_TEXT_MIN,
    remedy: "A sentence or two is enough to show how you write.",
  },
};

const STYLE_NOTE: VoiceTextField = {
  path: "styleNote",
  noun: "A style note",
  tooLongRemedy: "Trim it — about three paragraphs of guidance is the limit.",
  floor: null,
};

/**
 * The sentence to show when a voice route refused what was written.
 *
 * WHICH FIELD comes from the response's `issues`; WHICH BOUND it missed comes
 * from the text the caller submitted. Both halves are needed, and the split is
 * not laziness: `formatZodIssues` (`schemas/common.ts:58`) keeps only `path` and
 * `message` and drops Zod's `code`, so "too_small" versus "too_big" never
 * reaches the browser as data — only inside an English message Zod is free to
 * reword between versions. The length of the string the caller just sent is the
 * one fact about the direction that cannot go stale.
 *
 * Both bounds are live on a SAMPLE: a long edited chapter trips the ceiling, a
 * chapter cut down to a line trips the floor. Describing the second as the first
 * would send an advisor to shorten something already too short. A STYLE NOTE has
 * no floor at all, which is why `floor` is nullable rather than a shared 20.
 *
 * Anything else — a 403, a 500, a dropped connection, a 400 about some other
 * field — falls through to `generic`, which each surface words for itself.
 */
function refusal(field: VoiceTextField, body: unknown, value: string, generic: string): string {
  if (!fieldWasRefused(body, field.path)) return generic;
  if (value.length > VOICE_TEXT_MAX) {
    return (
      `That's ${commas(value.length)} characters. ${field.noun} can be at most ` +
      `${commas(VOICE_TEXT_MAX)}, so nothing was saved. ${field.tooLongRemedy}`
    );
  }
  if (field.floor != null && value.length < field.floor.min) {
    return (
      `That's ${commas(value.length)} characters. ${field.noun} needs at least ` +
      `${commas(field.floor.min)}, so nothing was saved. ${field.floor.remedy}`
    );
  }
  return generic;
}

/** `POST /api/story-voice/samples` — both bounds live. */
export function sampleRefusal(body: unknown, text: string, generic: string): string {
  return refusal(SAMPLE, body, text, generic);
}

/** `PUT /api/story-voice` — a ceiling only. */
export function styleNoteRefusal(body: unknown, styleNote: string, generic: string): string {
  return refusal(STYLE_NOTE, body, styleNote, generic);
}
