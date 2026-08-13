// Chapter 7 — how much they can spend a year without running short.
//
// The single most misread number in the deck. "What you can spend" without
// "in today's money" is a figure a client compares against their current pay
// cheque and against a statement twenty years out, and those are not the same
// number — so the real-vs-nominal gloss is not optional here, it is the chapter.
//
// `twoUp`, so the prose budget is 130 words. See `will-the-money-last.ts`.
import { factDisplay, type StoryContext } from "../types";

const NOTHING_KNOWN =
  "The most you can spend each year without running short is a figure we work out separately. It didn't come back this time, so we'll go through it together.";

/** Never dropped when a figure prints. Without it the number is read against
 *  today's pay cheque AND against a statement twenty years out, and it cannot
 *  mean both. */
const TODAYS_MONEY =
  "That's in today's money — what that amount buys now, not what it will say on a statement in twenty years.";

/** "The difference" needs two figures to be a difference. With one, the chapter
 *  closes on what the figure is FOR instead of on a comparison it cannot make. */
const CLOSES_ON_THE_GAP = "The difference is what the changes buy you.";
const CLOSES_ON_THE_FIGURE = "That's the figure the whole plan is built to protect.";
const POINTS_FORWARD = "The pages that follow show where that comes from.";

export function narrateWhatYouCanSpend(ctx: StoryContext): string[] {
  const base = factDisplay(ctx, "spend.base");
  const proposed = factDisplay(ctx, "spend.proposed");

  if (!base && !proposed) return [NOTHING_KNOWN];

  const paragraphs: string[] = [];

  if (proposed) {
    paragraphs.push(`In retirement, the plan we're proposing supports spending of about ${proposed} a year.`);
  } else {
    paragraphs.push(`In retirement, your current plan supports spending of about ${base} a year.`);
  }

  paragraphs.push(TODAYS_MONEY);

  // The comparison only when there are two figures to compare — and only after
  // the gloss, so the qualifier lands before a second number does.
  const both = Boolean(proposed && base);
  if (both) paragraphs.push(`Your current plan supports about ${base}.`);

  paragraphs.push(
    ctx.documentRole === "frontMatter"
      ? POINTS_FORWARD
      : both
        ? CLOSES_ON_THE_GAP
        : CLOSES_ON_THE_FIGURE,
  );

  return paragraphs;
}
