// Chapter 6 — how the plan held up across the runs we tested, and what the
// changes did to that.
//
// `twoUp`, so the prose budget is 130 words rather than heroProse's 300 (see
// `view-model.ts#BUDGET_WORDS_TWO_UP`). Short paragraphs here are the format,
// not a style choice — the figure column takes a third of the text measure.
import { factDisplay, findFact, type StoryContext } from "../types";

const NOTHING_KNOWN =
  "We test the plan against thousands of market futures — good years and bad. That run didn't finish this time, so we'll walk you through it together.";

/**
 * The two closings are deliberately DIFFERENT LENGTHS from each other and from
 * the two sentences above them.
 *
 * Gate 4 rejects prose whose sentences are all about the same length, measured
 * as spread relative to the mean — and this chapter is three sentences long, so
 * there is nowhere for an even cadence to hide. The one-confidence branch with
 * the forward pointer scored 0.113 against a floor of 0.122 with a nine-word
 * closing: a chapter that publishes prose its own gate refuses is a chapter
 * whose gate is unusable.
 */
const CLOSES_THE_THOUGHT = "That's the number to watch.";
const POINTS_FORWARD = "The pages that follow show how the plan gets there, step by step.";

/** The framing sentence. Doubles as the gloss Gate 2 wants: "confidence" is the
 *  report's central term and a lay reader cannot be assumed to know it, so the
 *  chapter says what was actually measured before it prints a percentage. */
const HOW_WE_TESTED = "We tested the plan against thousands of market futures.";

/**
 * How the two confidences compare, in one clause.
 *
 * Equal DISPLAYS mean "the same", whatever the raw values do. 0.9061 and 0.9064
 * are a rise in the data and both print "90.6%", and "up from 90.6% to 90.6%"
 * puts two identical figures on a client's page either side of the word "up".
 * Only once the two read differently is the direction taken from `raw`, which is
 * the right source precisely because `display` is rounded.
 */
function movement(ctx: StoryContext): string {
  const base = findFact(ctx, "outcome.confidence.base");
  const proposed = findFact(ctx, "outcome.confidence.proposed");
  if (!base || !proposed || base.display === proposed.display) {
    return "the same as on your current path";
  }
  const rose = (proposed.raw ?? 0) > (base.raw ?? 0);
  return `${rose ? "up" : "down"} from ${base.display} on your current path`;
}

export function narrateWillTheMoneyLast(ctx: StoryContext): string[] {
  const base = factDisplay(ctx, "outcome.confidence.base");
  const proposed = factDisplay(ctx, "outcome.confidence.proposed");

  if (!base && !proposed) return [NOTHING_KNOWN];

  const paragraphs: string[] = [HOW_WE_TESTED];

  if (proposed && base) {
    // An em-dash for the unchanged case and a comma for a real move: "up from"
    // reads as a continuation, "the same as" as an aside.
    const how = movement(ctx);
    paragraphs.push(
      how.startsWith("the same")
        ? `It holds up in ${proposed} of them — ${how}.`
        : `It holds up in ${proposed} of them, ${how}.`,
    );
  } else if (proposed) {
    paragraphs.push(`It holds up in ${proposed} of them.`);
  } else {
    paragraphs.push(`On your current plan it holds up in ${base} of them.`);
  }

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
