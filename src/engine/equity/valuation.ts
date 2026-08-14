import type { StockOptionPlan, EquityGrant } from "./types";
import { buildGrantTimeline, type EquityAction } from "./timeline";
import { resolveStrategy } from "./strategy";
import { projectFmv, resolveStrikePrice } from "./price-model";

/** Shares of `grant` still under option/RSU as of `year` — a QUANTITY, not a
 *  per-row flag. Shares already sold never come back, and every acquisition or
 *  expiry drains the grant by its own share count, so a grant that is partly
 *  exercised (or partly sold) keeps its remainder instead of collapsing to
 *  all-or-nothing.
 *
 *  Counted per GRANT rather than per vesting row on purpose. An 83(b) election
 *  is acquired as one whole-grant event that `buildGrantTimeline` hangs off the
 *  first row, so row-by-row accounting leaves the remaining rows with no event
 *  to drain them and values them a second time on top of the destination
 *  account. Totalling first means nothing here has to know that.
 *
 *  Sells are deliberately not drained: they take shares out of the destination
 *  account, which those shares left at their acquisition event. Each kind is
 *  listed explicitly so a new action kind has to opt in to draining. */
function sharesStillInGrant(grant: EquityGrant, timeline: EquityAction[], year: number): number {
  let remaining = grant.tranches.reduce((s, t) => s + t.shares - t.sharesSold, 0);
  for (const a of timeline) {
    if (a.year > year) continue;
    if (a.kind === "seed_held" || a.kind === "acquire_rsu" || a.kind === "exercise" || a.kind === "expire") {
      remaining -= a.shares;
    }
  }
  return Math.max(0, remaining);
}

/** Value of shares still in the option/RSU (not yet acquired into the destination
 *  account, not expired) as of `year`. Unvested RSU at FMV; unexercised options
 *  at intrinsic (FMV − strike, floored at 0). Held shares are excluded — they
 *  live in the destination taxable account.
 *
 *  `priceYear` is the year whose projected FMV prices what is left, and defaults
 *  to `year` — a start-of-year, "as of today" figure. The projection passes
 *  `year + 1` so this balance is stamped grown-through-year-end like every other
 *  account is after the growth loop; without that, shares picked up a full year
 *  of growth on the way into the destination account (which the growth loop DOES
 *  grow), stepping net worth up with no economic event. */
export function remainingGrantValue(
  plan: StockOptionPlan,
  year: number,
  planStartYear: number,
  priceYear: number = year,
): number {
  const acct = resolveStrategy(plan.strategy, null, null);
  const fmv = projectFmv(plan.pricePerShare, plan.growthRate, priceYear, planStartYear);
  let total = 0;
  for (const grant of plan.grants) {
    const timeline = buildGrantTimeline(grant, acct, planStartYear);
    const shares = sharesStillInGrant(grant, timeline, year);
    if (shares <= 0) continue;
    if (grant.grantType === "rsu") {
      total += shares * fmv;
    } else {
      const strike = resolveStrikePrice(grant, fmv);
      total += shares * Math.max(0, fmv - strike);
    }
  }
  return total;
}
