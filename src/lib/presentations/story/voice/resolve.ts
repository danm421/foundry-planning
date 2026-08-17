// Profile + samples → the two things the prompt takes. Pure, and the ONE
// spelling of the rule: `run-context.ts` calls it so the generate route and the
// staleness route are handed the identical voice. Two callers deriving it
// separately would differ by one disabled sample and report every chapter of
// every report out of date, permanently, with nothing to clear it.
import type { StoryVoiceSampleRow } from "@/db/schema";
import type { VoiceProfile } from "./repo";

export interface StoryVoice {
  /** The advisor's own description of how they write. "" when unset. */
  styleNote: string;
  /** Scrubbed exemplars, already safe to send. Newest first. */
  samples: string[];
}

/** Frozen at BOTH levels — the list separately, because freezing the wrapper
 *  leaves the array it holds open. It is ONE object used as the default at
 *  dozens of call sites, so a single `EMPTY_VOICE.samples.push(...)` anywhere
 *  would change the system prompt, and every hash written from it, everywhere
 *  at once. Two statements rather than a nested `Object.freeze`, which returns a
 *  `readonly` type that `StoryVoice.samples` will not take. */
const NO_SAMPLES: string[] = [];
Object.freeze(NO_SAMPLES);

export const EMPTY_VOICE: StoryVoice = Object.freeze({ styleNote: "", samples: NO_SAMPLES });

/**
 * At most four. Every sample is a quoted block in the system prompt of every one
 * of fourteen chapters, so the cost is linear in this number and the return is
 * not: past three or four exemplars a model is matching an average rather than a
 * voice.
 *
 * Exported because the Settings → Voice panel marks which rows actually reach a
 * prompt, and a second `4` written over there would eventually disagree with
 * this one — a panel showing six live toggles over a resolver that sends four
 * reports a state the model never sees.
 *
 * ⚠️ Safe to import from a client component: every import in this file is
 * `import type`, so the emitted JS has no imports at all and nothing from
 * `@/db` or `./repo` follows it into a bundle.
 */
export const MAX_SAMPLES = 4;

/**
 * Is this sample eligible to be sent at all? Switched on, and with words in it.
 *
 * Exported alongside the cap and for the same reason: the panel has to apply the
 * IDENTICAL test before it takes the first four, or the rows it labels as "in
 * every chapter" are not the rows that are.
 */
export function isSendable(sample: { enabled: boolean; text: string }): boolean {
  return sample.enabled && sample.text.trim().length > 0;
}

export function resolveVoice(
  profile: VoiceProfile | null,
  samples: StoryVoiceSampleRow[],
): StoryVoice {
  return {
    styleNote: profile?.styleNote ?? "",
    samples: samples
      .filter(isSendable)
      .slice(0, MAX_SAMPLES)
      // The SAME string the filter judged: `isSendable` tests `text.trim()`, so
      // the raw text is a different string from the one that passed the check.
      // A sample stored as "\n\n  real  \n\n" reaches the prompt wrapped in empty
      // quoted lines top and bottom — noise in the one text kept for its shape.
      //
      // The ENDS are all this covers. The interior is `prompts.ts#quoteAdvisorText`,
      // which marks every line of a sample; before it existed, a sample's second
      // paragraph landed at instruction level in the system prompt.
      .map((s) => s.text.trim()),
  };
}
