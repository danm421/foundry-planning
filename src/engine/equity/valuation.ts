import type { StockOptionPlan } from "./types";
import { buildGrantTimeline } from "./timeline";
import { resolveStrategy } from "./strategy";
import { projectFmv, resolveStrikePrice } from "./price-model";

/** Value of shares still in the option/RSU (not yet acquired into the destination
 *  account, not expired) as of `year`. Unvested RSU at FMV; unexercised options
 *  at intrinsic (FMV − strike, floored at 0). Held shares are excluded — they
 *  live in the destination taxable account. */
export function remainingGrantValue(plan: StockOptionPlan, year: number, planStartYear: number): number {
  const acct = resolveStrategy(plan.strategy, null, null);
  const fmv = projectFmv(plan.pricePerShare, plan.growthRate, year, planStartYear);
  let total = 0;
  for (const grant of plan.grants) {
    const timeline = buildGrantTimeline(grant, acct, planStartYear);
    for (const tranche of grant.tranches) {
      const actions = timeline.filter((a) => a.trancheId === tranche.id);
      const acquired = actions.some((a) => (a.kind === "acquire_rsu" || a.kind === "exercise" || a.kind === "seed_held") && a.year <= year);
      const expired = actions.some((a) => a.kind === "expire" && a.year <= year);
      if (acquired || expired) continue; // moved out or gone
      const shares = grant.grantType === "rsu" ? tranche.shares : tranche.shares - tranche.sharesExercised;
      if (shares <= 0) continue;
      if (grant.grantType === "rsu") {
        total += shares * fmv;
      } else {
        const strike = resolveStrikePrice(grant, fmv);
        total += shares * Math.max(0, fmv - strike);
      }
    }
  }
  return total;
}
