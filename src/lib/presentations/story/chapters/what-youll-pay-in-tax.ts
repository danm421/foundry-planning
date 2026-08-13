// Chapter 9 — what income tax costs over the life of the plan, and what the
// changes do to it.
//
// A COVERAGE chapter: it keeps its reserved sheet on a household whose tax
// engine produced nothing, and prints the empty state rather than a blank.
//
// ⚠️ THE DIRECTION IS NOT ALWAYS "LESS". A Roth conversion RAISES lifetime
// income tax on purpose — that is what it buys — and it is one of the most
// common strategies this app models. A chapter that only knew how to say "you
// save" would tell those households the opposite of what their plan does, so
// every branch below is written both ways and the suite pins both.
//
// `twoUp`: the prose budget is 130 words, and the two totals print as cards
// beside it.
import { factDisplay, findFact, type StoryContext } from "../types";

/** The framing sentence. Doubles as the gloss a lifetime total needs: people
 *  read a tax figure as this year's bill, and this one is every year added up. */
const WHAT_IT_COVERS =
  "Tax is one of the largest costs in a plan, and it comes out year after year.";

const NOTHING_KNOWN = `${WHAT_IT_COVERS} We don't have those totals to show here, so we'll go through them together.`;

/** Different lengths from each other and from the sentences above them — Gate 4
 *  judges the spread relative to the mean, and this chapter is four sentences. */
const CLOSES_THE_THOUGHT = "It's a cost worth planning around.";
const POINTS_FORWARD = "The pages that follow break it down year by year.";

/**
 * What the changes do to the total, in one sentence — or null when there is
 * only one total to state.
 *
 * Equal DISPLAYS mean "about the same", whatever `raw` does: $1.16M and $1.24M
 * both print "$1.2M", and "less" between two identical figures is a claim the
 * cards beside the prose refute. Direction comes off `raw` only once the two
 * read differently.
 *
 * The rise branch says "more" and nothing else — no "lower", no "saves". That
 * is what the suite checks, and it is the honest sentence: this chapter cannot
 * see WHY the tax went up, and a proposal that pays tax early to buy something
 * later is explained by the recommendation chapter, not by this one.
 */
function movement(ctx: StoryContext): string | null {
  const base = findFact(ctx, "tax.lifetime.base");
  const proposed = findFact(ctx, "tax.lifetime.proposed");
  if (!base || !proposed) return null;
  if (base.display === proposed.display) {
    return "The changes we're proposing leave that about the same.";
  }
  return (proposed.raw ?? 0) < (base.raw ?? 0)
    ? `The changes we're proposing bring that to about ${proposed.display} — less, over the same years.`
    : `The changes we're proposing take that to about ${proposed.display}, which is more than your current path.`;
}

export function narrateWhatYoullPayInTax(ctx: StoryContext): string[] {
  const base = factDisplay(ctx, "tax.lifetime.base");
  const proposed = factDisplay(ctx, "tax.lifetime.proposed");

  if (!base && !proposed) return [NOTHING_KNOWN];

  // Lead on the current plan wherever we have it, so the sentence after it has
  // something to move FROM.
  const leadsOnBase = base != null;
  const paragraphs = [
    WHAT_IT_COVERS,
    leadsOnBase
      ? `Over the whole plan, your current path pays about ${base} in income tax.`
      : `Over the whole plan, the changes we're proposing come to about ${proposed} in income tax.`,
  ];

  const move = leadsOnBase ? movement(ctx) : null;
  if (move) paragraphs.push(move);

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
