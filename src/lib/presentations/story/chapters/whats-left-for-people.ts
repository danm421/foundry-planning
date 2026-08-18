// Chapter 8 — what reaches the people and causes they've named, once the
// estate has been settled.
//
// The first COVERAGE chapter: a household with no estate to speak of still gets
// its reserved sheet, and what prints on it is the empty state below rather than
// a blank. `printedChapters` cannot see the data (see `options-schema.ts`), so
// the honest sentence is the chapter's job, not the print list's.
//
// `twoUp`, so the prose budget is 130 words and the four estate figures print as
// cards beside it. See `will-the-money-last.ts` for what that costs in rhythm.
import { factDisplay, findFact, type StoryContext } from "../types";

const NOTHING_KNOWN =
  "What's left at the end goes to the people and causes you've named. We don't have those figures worked through yet, so we'll go over them together.";

/** The framing sentence, and the gloss with it: "what's left" means after the
 *  estate has paid what it owes, which is the whole reason the figure is
 *  smaller than the net worth a client has in mind. */
const WHERE_IT_GOES = "What's left at the end goes to the people and causes you've named.";

/**
 * The two closings are deliberately DIFFERENT LENGTHS from each other and from
 * the sentences above them — Gate 4 measures the spread relative to the mean,
 * and a twoUp chapter is short enough that an even cadence has nowhere to hide.
 */
const CLOSES_THE_THOUGHT = "It's what the plan is protecting for them.";
const POINTS_FORWARD = "The pages that follow show who receives what, and when.";

/**
 * What the changes do to the figure, in one sentence — or null when there is no
 * second figure to compare against.
 *
 * Equal DISPLAYS mean "unchanged", whatever `raw` does. $9.16M and $9.24M are a
 * rise in the data and both print "$9.2M", and "lifts that to $9.2M" beside
 * $9.2M is a claim the card next to it refutes. Only once the two read
 * differently is the direction taken from `raw`, which is the right source
 * precisely because `display` is rounded.
 */
function movement(ctx: StoryContext): string | null {
  const base = findFact(ctx, "estate.net.base");
  const proposed = findFact(ctx, "estate.net.proposed");
  if (!base || !proposed) return null;
  if (base.display === proposed.display) {
    return "The changes we're proposing leave that unchanged.";
  }
  const up = (proposed.raw ?? 0) > (base.raw ?? 0);
  return `The changes we're proposing ${up ? "lift" : "lower"} that to about ${proposed.display}.`;
}

/**
 * What time does to the whole estate, in one sentence — base decks only, where
 * the chart's two bars are today and the end of the plan.
 *
 * Equal DISPLAYS mean neither, whatever `raw` does: $4.01M and $4.04M both
 * print "$4.0M", and "smaller" between two identical figures is a claim the
 * picture beside it refutes. Direction comes off `raw` only once the two read
 * differently — the same rule `movement` above follows.
 *
 * ⚠️ NOT always smaller. An estate that keeps compounding past what the plan
 * spends grows, and this chapter cannot see which it will be.
 */
function overTheYears(ctx: StoryContext): string | null {
  const today = findFact(ctx, "chart.estate.grossToday");
  const end = findFact(ctx, "chart.estate.grossEndOfLife");
  if (!today || !end) return null;
  if (today.display === end.display) {
    return `The whole estate is about ${today.display} today, and about the same at the end of the plan.`;
  }
  const grows = (end.raw ?? 0) > (today.raw ?? 0);
  return `The whole estate is about ${today.display} today and about ${end.display} by the end of the plan — ${grows ? "larger" : "smaller"}, before anything comes out of it.`;
}

export function narrateWhatsLeftForPeople(ctx: StoryContext): string[] {
  const base = factDisplay(ctx, "estate.net.base");
  const proposed = factDisplay(ctx, "estate.net.proposed");

  if (!base && !proposed) return [NOTHING_KNOWN];

  // Lead on the current plan wherever we have it, so the sentence after it has
  // something to move FROM. With only a proposal there is nothing to move from,
  // and the chapter states the one figure rather than implying a comparison.
  const leadsOnBase = base != null;
  const paragraphs = [
    WHERE_IT_GOES,
    leadsOnBase
      ? `On your current plan that's about ${base}.`
      : `Under the plan we're proposing, that's about ${proposed}.`,
  ];

  const move = leadsOnBase ? movement(ctx) : null;
  if (move) paragraphs.push(move);

  // Base decks only: `move` is null without a proposed figure, and the two
  // gross facts exist only when the chart drew the today pair. Never both —
  // the two pairings are the two deck kinds (see `build-facts.ts`).
  const overTime = move ? null : overTheYears(ctx);
  if (overTime) paragraphs.push(overTime);

  // The cost of the plan we just named, never the other one's — the two are a
  // pair of cards side by side, and a sentence that silently swapped sides
  // would disagree with the column beside it.
  const cost = factDisplay(ctx, leadsOnBase ? "estate.cost.base" : "estate.cost.proposed");
  if (cost) {
    paragraphs.push(`Tax and the cost of settling the estate take about ${cost} before it gets there.`);
  }

  paragraphs.push(ctx.documentRole === "frontMatter" ? POINTS_FORWARD : CLOSES_THE_THOUGHT);

  return paragraphs;
}
