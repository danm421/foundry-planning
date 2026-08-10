import { z } from "zod";

/** Bumped whenever the prompt or the item shape changes. Persisted alongside
 *  the blob in `tax_return_state.ai_second_read_version`, so a stored read
 *  produced by an older prompt reports itself stale without the document set
 *  having changed. */
export const SECOND_READ_VERSION = "2026-08-10.1";

/** The panel is a supplement to 22 deterministic findings, not a second
 *  report. A model asked for "anything else" will happily produce twenty
 *  items; capping is what keeps the AI lane visibly subordinate. */
export const MAX_SECOND_READ_ITEMS = 6;

const MAX_QUOTED_VALUE_CHARS = 40;

/**
 * What the model is allowed to return.
 *
 * D12 IS THIS SCHEMA. There is no numeric field anywhere in it. `quotedValue`
 * is a string because a string cannot be summed, formatted as a computed
 * dollar figure, or sorted against a deterministic finding's
 * `estimatedImpact` — a transcription error stays a transcription error the
 * advisor catches against the form, instead of becoming a conclusion.
 *
 * Deliberately NOT `.strict()`: a model that volunteers `estimatedImpact`
 * must have that key STRIPPED, not have the whole item rejected. Rejecting
 * would throw away a genuine observation over a key we were always going to
 * ignore.
 */
export const aiResponseSchema = z.object({
  items: z
    .array(
      z.object({
        headline: z.string().min(1),
        detail: z.string().min(1),
        form: z.string().nullable().default(null),
        line: z.string().nullable().default(null),
        quotedValue: z.string().max(MAX_QUOTED_VALUE_CHARS).nullable().default(null),
      }),
    )
    .default([]),
});

export interface SecondReadItem {
  /** Minted at generation (`sr-1`, `sr-2`, …). Stable only within one blob —
   *  regeneration mints fresh ids, which is why dismissals cannot carry
   *  forward (D13). */
  id: string;
  headline: string;
  detail: string;
  form: string | null;
  line: string | null;
  /** A transcription, exactly as printed. Never a number. */
  quotedValue: string | null;
  dismissed: boolean;
}

export interface SecondRead {
  generatedAt: string;
  /** Documents that could not be read back out of the vault. Surfaced in the
   *  panel so "nothing found" is never confused with "nothing looked at". */
  warnings: string[];
  items: SecondReadItem[];
}

/** Re-validated on every READ of the persisted jsonb, exactly as
 *  `parseRowFacts` re-validates facts. Every field added *after v1* must carry
 *  a `.default(...)` so a blob written by an older version still parses instead
 *  of blanking the panel. The v1 identity fields (`generatedAt`, `id`,
 *  `headline`, `detail`) deliberately carry no defaults: a blob missing one of
 *  them is unusable rather than merely older, and failing to parse it hides the
 *  panel rather than rendering a broken card.
 *
 *  Deliberately UNANNOTATED. A `z.ZodType<SecondRead>` annotation would fight
 *  the `.default(...)`s — a defaulted field's INPUT type is optional while its
 *  OUTPUT type is not, so the two sides of the annotation can never both hold.
 *  The `satisfies` line below gets the same guarantee from the output type
 *  alone: add a field to `SecondRead` without adding it here and it fails to
 *  compile. */
export const secondReadSchema = z.object({
  generatedAt: z.string(),
  warnings: z.array(z.string()).default([]),
  items: z
    .array(
      z.object({
        id: z.string(),
        headline: z.string(),
        detail: z.string(),
        form: z.string().nullable().default(null),
        line: z.string().nullable().default(null),
        quotedValue: z.string().nullable().default(null),
        dismissed: z.boolean().default(false),
      }),
    )
    .default([]),
});

// Compile-time pin: the schema's parsed OUTPUT is exactly `SecondRead`.
const _secondReadShapeCheck = {} as z.infer<typeof secondReadSchema> satisfies SecondRead;
void _secondReadShapeCheck;
