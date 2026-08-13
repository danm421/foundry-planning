// Chapter 10 — what their cover would do for the survivor, and where it falls
// short of what the plan points to.
//
// A COVERAGE chapter: a household with no policies on file still gets its
// reserved sheet, and what prints on it is the empty state below rather than a
// blank. `printedChapters` cannot see the data (see `options-schema.ts`), so the
// honest sentence is the chapter's job, not the print list's.
//
// ONE life, not two. A household has two answers here — the plan points to a
// different amount on each life — and `load-context.ts` reduces them to the life
// they are furthest short on, because this layout prints five figure cards and a
// sixth fact drops one. WHICH life is in the fact LABELS ("Cover in force on
// Cooper's life"): Gate 6 rejects a first name written as anything but direct
// address, so the card caption beside the paragraph is where the name belongs,
// and the prose says "that life".
//
// `twoUp`, so the prose budget is 130 words and the cover figures print as cards
// beside it. See `will-the-money-last.ts` for what that costs in rhythm.
import { factDisplay, findFact, type StoryContext } from "../types";

/**
 * The framing sentence, and deliberately the LONGEST unit in the chapter.
 *
 * Gate 4 measures the spread relative to the mean and a `twoUp` chapter runs to
 * three or four sentences, so an even cadence has nowhere to hide. This sentence
 * and the closings below are the two ends of the range that buys the spread —
 * the shortest shape here still clears the floor with room.
 */
const IF_ONE_OF_YOU =
  "If one of you weren't here tomorrow, life cover is what would keep the rest of this plan on track.";

/** No policies on file and no usable solve. Said plainly, and paired with the
 *  lead — two units, which is below the rhythm rule's floor of three. */
const NOTHING_KNOWN =
  "We don't have your policies worked through yet, so we'll go over them together.";

/** The two closings are different lengths from each other and from the sentences
 *  above them, for the reason given on `IF_ONE_OF_YOU`. */
const CLOSES_THE_THOUGHT = "We'll go through the policies together.";
const POINTS_FORWARD = "The pages that follow set out every policy and who it pays.";

/**
 * What the cover does against what the plan points to — or null when there is no
 * second figure to compare it against, which is a solve that answered only for
 * what is already in force.
 *
 * `cover.gap` is ABSENT rather than zero when the cover is enough (see
 * `build-facts.ts#coverFacts`), so "enough" is a MISSING FACT here rather than a
 * comparison of two numbers — and a "$0 short" card never prints beside a
 * sentence saying there is nothing missing.
 */
function verdict(ctx: StoryContext): string | null {
  const need = factDisplay(ctx, "cover.need");
  if (!need) return null;
  const gap = factDisplay(ctx, "cover.gap");
  return gap
    ? `The plan points to about ${need}, which leaves you around ${gap} short.`
    : `That's enough to cover what the plan points to, about ${need}.`;
}

export function narrateProtectingYourFamily(ctx: StoryContext): string[] {
  const have = findFact(ctx, "cover.have");
  if (!have) return [IF_ONE_OF_YOU, NOTHING_KNOWN];

  // Nothing in force is a STATEMENT, never a figure. "$0" is an honest number
  // and the sentence the design wraps it in is not: "the policies in force on
  // that life would pay about $0" describes policies this household does not
  // have. Read off `raw` rather than off the display, so the branch is about the
  // cover and not about how it rounded.
  const inForce =
    (have.raw ?? 0) > 0
      ? `The policies in force on that life would pay about ${have.display}.`
      : "There's no cover in force on that life today.";

  const paragraphs = [IF_ONE_OF_YOU, inForce];

  const said = verdict(ctx);
  if (said) paragraphs.push(said);

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
