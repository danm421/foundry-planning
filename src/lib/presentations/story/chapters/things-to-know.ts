// Chapter 13 — what the plan assumes, and the plain meaning of the words that
// came with it.
//
// The last sheet, and the only one whose job is to make the previous twelve
// readable rather than to add a figure. Two halves, and only the first is
// written here: the assumptions the plan actually ran on, said as sentences
// rather than as the Planning Assumptions page's grid. The second half is the
// glossary — the report's side of the bargain Gate 2 strikes, since that gate
// refuses a term used without an explanation and `glossary.test.ts` pins that
// every banned term has one.
//
// Deliberately the same in both registers, like chapter 12 and unlike every
// other chapter. A `frontMatter` chapter is told to point at the pages that
// follow, and the page that sets these assumptions out in full is Planning
// Assumptions — which an advisor may or may not have put in the deck. Pointing
// at a page that might not be there is the one thing a forward reference must
// never do.
//
// ⚠️ The glossary itself is NOT written here. It is a structured field on
// `PlanStoryChapterView`, printed by the `glossary` layout — because stored text
// wins over this narrator at export, and a model asked for two short paragraphs
// will never write eleven definitions back. In prose the glossary would appear
// only on decks that were never generated. What this file writes is the prose
// AROUND it, which the model is free to replace.
import { factDisplay, findFact, type StoryContext } from "../types";

/**
 * The opening, and the one sentence this chapter exists to say.
 *
 * Two units, and short — the assumption sentences below run long, and Gate 4
 * judges the spread across the whole chapter rather than the length of any one
 * line. With the glossary printed by the layout rather than written here, these
 * three paragraphs are the whole of what the gates see, so the short opening is
 * what keeps the rhythm off the floor.
 */
const NOT_A_PROMISE =
  "A plan is a projection, not a promise. Here's what sits underneath yours.";

/**
 * Growth, without a number.
 *
 * There is no household growth RATE to state: the plan sets one per account
 * category and lets each account override it, so any single figure here would
 * be a definition this report invented — and it would sit a few leaves from the
 * Planning Assumptions page's own per-category grid, disagreeing with it. The
 * honest version says what is true and does not pretend to a total.
 */
const HOW_THINGS_GROW =
  "Your accounts don't all grow at the same rate — cash behaves nothing like a stock portfolio.";

/**
 * Tax, also without a number, and for a different reason: the plan works it out
 * year by year from the income it projects, so there is no single rate to quote
 * even when the advisor has set one.
 */
const HOW_TAX_IS_WORKED_OUT =
  "Tax is worked out year by year, on the income the plan expects.";

/** Prices, when the advisor has deliberately set no inflation at all. Said
 *  rather than skipped: "we assumed nothing" is itself an assumption a client
 *  is entitled to know about, and it needs no figure to state. */
const PRICES_HELD_FLAT = "We've held prices flat, so every figure is in today's money.";

/** The advisor's own words are the last thing on the sheet, and the only
 *  invitation this report makes. */
const ASK_US = "Anything here you want gone over again, just ask.";

/**
 * The horizon and the price assumption, as one sentence or as however much of
 * it the pack can support.
 *
 * Both figures are read back through the pack rather than printed from the
 * context, exactly as every other narrator does: a four-digit year is a figure
 * to Gate 1, and so is a percentage.
 */
function whatWeAssumed(ctx: StoryContext): string[] {
  const lastYear = factDisplay(ctx, "plan.endOfLifeYear");
  const rate = findFact(ctx, "plan.inflationRate");

  const said: string[] = [];
  if (lastYear) said.push(`We've run your money out to ${lastYear}.`);
  // A rate of zero is a real setting — an advisor working in today's money —
  // and "prices rise about 0% a year" is a sentence no advisor would write. The
  // fact is still in the pack; what changes is which sentence it licenses.
  if (rate) {
    said.push(
      (rate.raw ?? 0) > 0
        ? `We've assumed prices keep rising about ${rate.display} a year.`
        : PRICES_HELD_FLAT,
    );
  }
  return said;
}

export function narrateThingsToKnow(ctx: StoryContext): string[] {
  return [
    NOT_A_PROMISE,
    [...whatWeAssumed(ctx), HOW_THINGS_GROW, HOW_TAX_IS_WORKED_OUT].join(" "),
    ASK_US,
  ];
}
