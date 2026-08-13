// Chapter 4 — the base case, stated honestly as a trajectory.
//
// Without a problem, chapter 5 has no solution: the reader cannot tell whether
// the changes fixed something or were optional. So this narrator's job is to say
// what happens if nothing changes, including when that is uncomfortable — and to
// gloss "confidence" every time, because it is the report's central term and the
// spec names it as one a lay reader cannot be assumed to know.
import { factDisplay, type StoryContext } from "../types";

/**
 * Deliberately not the "we'd normally walk through…" shape chapter 3 uses for
 * its own empty pack. Both fire together when a projection fails to load, and
 * two sheets opening with the same sentence read as a template rather than as a
 * report someone wrote.
 */
const NOTHING_KNOWN =
  "We can't show where today's plan ends up without the projection behind it. That's a loading problem on our side, not something about your money.";

/** The forward pointer, for the brief. `standalone` closes the thought instead —
 *  the one behavioural difference between the two presets, and the thing Plan 1
 *  shipped inert. */
const POINTS_FORWARD = "The pages that follow go through each of those in turn.";
const CLOSES_THE_THOUGHT =
  "That's the starting point. Everything we suggest from here is measured against it.";

export function narrateThePathYoureOn(ctx: StoryContext): string[] {
  const confidence = factDisplay(ctx, "outcome.confidence.base");
  const legacy = factDisplay(ctx, "outcome.legacy.base");
  const shortfall = factDisplay(ctx, "base.shortfallYear");
  const end = factDisplay(ctx, "plan.endOfLifeYear");

  if (!confidence && !legacy && !shortfall) return [NOTHING_KNOWN];

  const paragraphs: string[] = [];

  if (confidence) {
    // Glossed in the same sentence, per Gate 2 — and phrased as a count of runs
    // rather than as a probability, which is the thing lay readers misread.
    paragraphs.push(
      `If nothing changes, the plan works in ${confidence} of the futures we tested — thousands of runs, each one a different mix of good and bad market years.`,
    );
  }

  // The bad news first when there is bad news. A shortfall year is the single
  // most important thing on this sheet, and burying it under the legacy figure
  // is how a report ends up sounding reassuring about a plan that does not hold.
  if (shortfall) {
    paragraphs.push(
      `In the runs where it doesn't work, the money starts running short around ${shortfall}.`,
    );
  } else if (legacy && end) {
    paragraphs.push(`On the current path there's about ${legacy} still there in ${end}.`);
  } else if (legacy) {
    paragraphs.push(`On the current path there's about ${legacy} left at the end.`);
  }

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
