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
 * At most four. Every sample is a system-prompt line on every one of fourteen
 * chapters, so the cost is linear in this number and the return is not: past
 * three or four exemplars a model is matching an average rather than a voice.
 */
const MAX_SAMPLES = 4;

export function resolveVoice(
  profile: VoiceProfile | null,
  samples: StoryVoiceSampleRow[],
): StoryVoice {
  return {
    styleNote: profile?.styleNote ?? "",
    samples: samples
      .filter((s) => s.enabled && s.text.trim().length > 0)
      .slice(0, MAX_SAMPLES)
      // The SAME string the filter judged. Emitting the raw text instead would
      // let a sample stored with leading or trailing blank lines through the
      // blank check and then break its own "Sample: " line open — and in a
      // system prompt of one instruction per line, a bare line is an
      // instruction.
      .map((s) => s.text.trim()),
  };
}
