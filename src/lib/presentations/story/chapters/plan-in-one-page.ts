// Chapter 0's deterministic fallback. Same shape as
// retirement-summary/narrative.ts: pure, figure-safe, a handful of lines.
import { factDisplay, findFact, type StoryContext } from "../types";

/** Last resort. This chapter is what the client reads when generation is off or
 *  the model's draft was rejected, so it may not come back blank — a fact pack
 *  can arrive with neither Monte Carlo run and no balance sheet. */
const NOTHING_TO_REPORT =
  "Here's where your plan stands today, and what it looks like from here.";

/** How the proposed number relates to the current one. Read from `raw`, not from
 *  the rounded display: two runs a tenth of a point apart print the same string,
 *  and "up from 73% … 73%" is a sentence no advisor would sign. */
function movement(proposedRaw: number, baseRaw: number): string {
  if (proposedRaw > baseRaw) return "up from";
  if (proposedRaw < baseRaw) return "down from";
  return "no change from";
}

/**
 * Base and proposed Monte Carlo runs fail independently, so all four
 * combinations of the two confidence facts reach this function in production.
 * A pack carrying only the proposed run is the one the brief's original
 * `hasProposal && base && proposed` test dropped on the floor entirely.
 */
function confidenceLine(ctx: StoryContext): string | null {
  const base = findFact(ctx, "outcome.confidence.base");
  // With no proposal there is nothing to propose, whatever the pack holds.
  const proposed = ctx.hasProposal ? findFact(ctx, "outcome.confidence.proposed") : null;

  if (proposed && base) {
    const moved = movement(proposed.raw, base.raw);
    // "no change from your current path" — repeating the identical percentage
    // reads as a mistake, so the equal case names the path and not the number.
    const from = moved === "no change from" ? "your current path" : `${base.display} on your current path`;
    return `With the changes we're suggesting, the plan comes through in ${proposed.display} of the futures we tested — ${moved} ${from}.`;
  }
  if (proposed) {
    return `With the changes we're suggesting, the plan comes through in ${proposed.display} of the futures we tested.`;
  }
  if (base) {
    return `On your current path, the plan comes through in ${base.display} of the futures we tested.`;
  }
  return null;
}

export function narratePlanInOnePage(ctx: StoryContext): string[] {
  const lines: string[] = [];

  const confidence = confidenceLine(ctx);
  if (confidence) lines.push(confidence);

  if (ctx.hasProposal && ctx.strategies.length > 0) {
    const names = ctx.strategies.map((s) => s.name).join(", ");
    lines.push(`That comes from ${ctx.strategies.length === 1 ? "one change" : `${ctx.strategies.length} changes`}: ${names}.`);
  }

  const netWorth = factDisplay(ctx, "today.netWorth");
  if (netWorth) lines.push(`You're starting from ${netWorth}.`);

  return lines.length > 0 ? lines : [NOTHING_TO_REPORT];
}
