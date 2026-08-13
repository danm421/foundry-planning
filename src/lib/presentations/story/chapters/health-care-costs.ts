// Chapter 11 — what health care costs once work stops, and how much of it the
// plan already carries.
//
// A COVERAGE chapter, so a household that never reaches 65 inside the horizon
// keeps its reserved sheet and prints the empty state below.
//
// The CURRENT plan's figures, even on a deck that carries a proposal, and the
// fact labels say so. This chapter needs no proposal — an advisor runs it on a
// base-only annual review — and the arc has no Medicare comparison to make. A
// Roth conversion does move the surcharge, and that belongs to the tax chapter,
// which already states both plans.
//
// `twoUp`, so the prose budget is 130 words and the Medicare figures print as
// cards beside it.
import { factDisplay, type StoryContext } from "../types";

/**
 * The framing sentence, and the longest unit here for the same reason as chapter
 * 10's: it is what buys the three-sentence no-surcharge shape enough spread to
 * clear Gate 4 in BOTH registers. The obvious shorter lead does not — an earlier
 * draft of that shape scored a third of the floor.
 */
const ONCE_THE_PAYCHECKS_STOP =
  "Once the paychecks stop, health care becomes one of the larger bills a plan has to carry.";

/**
 * Nobody enrols inside the plan's horizon, so there is nothing to add up.
 *
 * "65" is safe in prose: Gate 1 does not read a bare two-digit integer as a
 * figure, because ages and counts are not plan outputs and the prose needs them
 * to read naturally (`validate/facts.ts`). A FOUR-digit year would not be safe.
 *
 * Two units, which is below the rhythm rule's floor of three.
 */
const NOT_YET: readonly string[] = [
  "Medicare picks up most of the health care bill from 65 onwards.",
  "You don't reach that point inside the years this plan covers, so there's nothing to add up yet.",
];

const CLOSES_THE_THOUGHT = "That's already in the numbers.";
const POINTS_FORWARD = "The pages that follow set it out year by year.";

export function narrateHealthCareCosts(ctx: StoryContext): string[] {
  const lifetime = factDisplay(ctx, "medicare.lifetime");
  if (!lifetime) return [...NOT_YET];

  const paragraphs = [
    ONCE_THE_PAYCHECKS_STOP,
    `Medicare comes to about ${lifetime} over the whole plan.`,
  ];

  // A SHARE of the total, never a bill beside it: printed as two independent
  // amounts, a client adds them together and doubles what health care costs.
  //
  // The fact is absent rather than zero when the household never crosses a
  // threshold (see `build-facts.ts#medicareFacts`), so this is a missing fact
  // and not a comparison. And the acronym is never written, glossed or
  // otherwise — the spec names that register as exactly what this report must
  // not assume its reader knows.
  const surcharge = factDisplay(ctx, "medicare.irmaa");
  if (surcharge) {
    paragraphs.push(
      `About ${surcharge} of that is the extra higher earners pay on top of the standard premium.`,
    );
  }

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
