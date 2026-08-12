// Chapter 0's deterministic fallback. Same shape as
// retirement-summary/narrative.ts: pure, figure-safe, a handful of lines.
import type { Fact } from "../facts";
import { factDisplay, findFact, type StoryContext } from "../types";

/** Last resort. This chapter is what the client reads when generation is off or
 *  the model's draft was rejected, so it may not come back blank — a fact pack
 *  can arrive with neither Monte Carlo run and no balance sheet. */
const NOTHING_TO_REPORT =
  "Here's where your plan stands today, and what it looks like from here.";

/**
 * How the proposed number relates to the current one.
 *
 * Equality is judged on `display`, NOT on `raw`. The client can only see the
 * rounded figure, so the sentence has to agree with the one on the page: two
 * runs with different trial counts (`successfulTrials / trialsRun`, and the app
 * requests 250 or 500 depending on the path) can differ in the eighth decimal
 * and both print "73%" — and "down from 73%" next to "73%" reads as a bug.
 * `raw` is still what picks the direction once the two genuinely differ.
 */
type Movement = "up" | "down" | "none" | "unknown";

function movement(proposed: Fact, base: Fact): Movement {
  if (proposed.display === base.display) return "none";
  // A quoted fact carries no `raw` (facts.ts#quotedFact), so two figures that
  // differ can still be unorderable. "none" would be a lie next to two
  // different percentages, so say the pair and skip the direction word.
  if (proposed.raw == null || base.raw == null) return "unknown";
  return proposed.raw > base.raw ? "up" : "down";
}

/**
 * Base and proposed Monte Carlo runs fail independently, so all four
 * combinations of the two confidence facts reach this function in production.
 * A pack carrying only the proposed run is the one the brief's original
 * `hasProposal && base && proposed` test dropped on the floor entirely.
 *
 * `comparison` tells the caller whether a base→proposed movement was actually
 * stated. The sentence that follows depends on it: only a real comparison can be
 * attributed to the recommended changes.
 */
function confidenceLine(base: Fact | null, proposed: Fact | null): { line: string; comparison: boolean } | null {
  if (proposed && base) {
    const moved = movement(proposed, base);
    // Repeating the identical percentage reads as a mistake, so the equal case
    // names the path and not the number.
    const phrase =
      moved === "none"
        ? "no change from your current path"
        : moved === "unknown"
          ? `against ${base.display} on your current path`
          : `${moved} from ${base.display} on your current path`;
    return {
      line: `With the changes we're suggesting, the plan comes through in ${proposed.display} of the futures we tested — ${phrase}.`,
      // A stated non-movement is not something the changes can be credited with,
      // so "That comes from…" may not follow it either — and neither can a
      // movement we could not name a direction for.
      comparison: moved === "up" || moved === "down",
    };
  }
  if (proposed) {
    return {
      line: `With the changes we're suggesting, the plan comes through in ${proposed.display} of the futures we tested.`,
      comparison: false,
    };
  }
  if (base) {
    return {
      line: `On your current path, the plan comes through in ${base.display} of the futures we tested.`,
      comparison: false,
    };
  }
  return null;
}

/** Advisor prose spells small numbers. Beyond nine, a digit is what anyone writes. */
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function countOfChanges(n: number): string {
  return `${COUNT_WORDS[n] ?? String(n)} ${n === 1 ? "change" : "changes"}`;
}

/** "A" · "A and B" · "A, B, and C" — the serial comma the house style uses. */
function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function narratePlanInOnePage(ctx: StoryContext): string[] {
  const lines: string[] = [];

  const base = findFact(ctx, "outcome.confidence.base");
  // With no proposal there is nothing to propose, whatever the pack holds.
  const proposed = ctx.hasProposal ? findFact(ctx, "outcome.confidence.proposed") : null;
  const confidence = confidenceLine(base, proposed);
  if (confidence) lines.push(confidence.line);

  if (ctx.hasProposal && ctx.strategies.length > 0) {
    const names = joinNames(ctx.strategies.map((s) => s.name));
    const count = countOfChanges(ctx.strategies.length);
    // "That comes from…" credits the movement to the changes, so it may only
    // follow a sentence that stated one. After a current-path-only number it
    // would attribute today's confidence to a change not yet made, and with no
    // confidence line at all it opens the chapter on a pronoun with no referent.
    lines.push(
      confidence?.comparison
        ? `That comes from ${count}: ${names}.`
        : `We're recommending ${count}: ${names}.`,
    );
  }

  const netWorth = factDisplay(ctx, "today.netWorth");
  if (netWorth) lines.push(`You're starting from ${netWorth}.`);

  return lines.length > 0 ? lines : [NOTHING_TO_REPORT];
}
