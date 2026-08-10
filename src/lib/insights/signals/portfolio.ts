import type { Signal, SignalInput } from "./types";

/** Cash share above which the drag is worth a conversation. */
export const CASH_DRAG_PCT = 0.10;
/** Single-position share of the liquid portfolio: watch, then critical. */
export const CONCENTRATION_WATCH_PCT = 0.10;
export const CONCENTRATION_CRIT_PCT = 0.20;

export function portfolioSignals(input: SignalInput): Signal[] {
  const { portfolio, clientId } = input;
  const out: Signal[] = [];

  // Both operands come from the allocation rollup. `liquidPortfolio` is a sum of
  // `accounts.value` over a DIFFERENT set — every account minus real estate,
  // business and life insurance — whereas `cashPct` is a share of only those
  // accounts carrying an asset mix. Multiplying one by the other mixed two bases
  // and overstated or understated the excess by whatever the gap happened to be.
  if (portfolio.cashPct > CASH_DRAG_PCT && portfolio.allocatedTotal > 0) {
    const excessDollars = (portfolio.cashPct - CASH_DRAG_PCT) * portfolio.allocatedTotal;
    // The firm's own CMA spread. A firm whose CMA says cash and equity return
    // the same gets an impact of 0 rather than a made-up number.
    const spread = Math.max(portfolio.equityReturn - portfolio.cashReturn, 0);
    out.push({
      id: "portfolio.cash_drag",
      domain: "portfolio",
      severity: "opportunity",
      title: `${Math.round(portfolio.cashPct * 100)}% of the allocated portfolio is in cash`,
      detail: `Of the ${Math.round(portfolio.allocatedTotal).toLocaleString("en-US")} dollars held in accounts with an asset mix on file, about ${Math.round(excessDollars).toLocaleString("en-US")} dollars sits above a ${Math.round(CASH_DRAG_PCT * 100)}% cash position, giving up roughly ${Math.round(excessDollars * spread).toLocaleString("en-US")} dollars a year at the firm's own return assumptions.`,
      numbers: { cashPct: portfolio.cashPct, excessDollars, spread, allocatedTotal: portfolio.allocatedTotal },
      href: `/clients/${clientId}/assets/investments`,
      estimatedImpact: excessDollars * spread,
    });
  }

  // Share is taken against the holdings this same scan totalled, never against
  // `liquidPortfolio` (a sum of `accounts.value`). Nothing keeps those two in
  // step — a price refresh moves the holdings and not the account value — so the
  // old ratio drifted on its own and could exceed 100%.
  const pos = portfolio.largestPosition;
  if (pos && pos.holdingsTotal > 0) {
    const share = pos.value / pos.holdingsTotal;
    if (share > CONCENTRATION_WATCH_PCT) {
      out.push({
        id: "portfolio.concentration",
        domain: "portfolio",
        severity: share > CONCENTRATION_CRIT_PCT ? "critical" : "watch",
        title: `${pos.label} is ${Math.round(share * 100)}% of reported holdings`,
        detail: `The largest single position, ${pos.label}, accounts for ${Math.round(share * 100)}% of the ${Math.round(pos.holdingsTotal).toLocaleString("en-US")} dollars of holdings on file — a single-name risk the plan's return assumptions do not model.`,
        numbers: { share, value: pos.value, holdingsTotal: pos.holdingsTotal },
        href: `/clients/${clientId}/assets/investments`,
        estimatedImpact: pos.value - CONCENTRATION_WATCH_PCT * pos.holdingsTotal,
      });
    }
  }

  return out;
}
