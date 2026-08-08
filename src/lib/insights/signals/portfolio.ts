import type { Signal, SignalInput } from "./types";

/** Cash share above which the drag is worth a conversation. */
export const CASH_DRAG_PCT = 0.10;
/** Single-position share of the liquid portfolio: watch, then critical. */
export const CONCENTRATION_WATCH_PCT = 0.10;
export const CONCENTRATION_CRIT_PCT = 0.20;

export function portfolioSignals(input: SignalInput): Signal[] {
  const { portfolio, clientId } = input;
  const out: Signal[] = [];

  if (portfolio.cashPct > CASH_DRAG_PCT && portfolio.liquidPortfolio > 0) {
    const excessDollars = (portfolio.cashPct - CASH_DRAG_PCT) * portfolio.liquidPortfolio;
    // The firm's own CMA spread. A firm whose CMA says cash and equity return
    // the same gets an impact of 0 rather than a made-up number.
    const spread = Math.max(portfolio.equityReturn - portfolio.cashReturn, 0);
    out.push({
      id: "portfolio.cash_drag",
      domain: "portfolio",
      severity: "opportunity",
      title: `${Math.round(portfolio.cashPct * 100)}% of the portfolio is in cash`,
      detail: `About ${Math.round(excessDollars).toLocaleString("en-US")} dollars sits above a ${Math.round(CASH_DRAG_PCT * 100)}% cash position, giving up roughly ${Math.round(excessDollars * spread).toLocaleString("en-US")} dollars a year at the firm's own return assumptions.`,
      numbers: { cashPct: portfolio.cashPct, excessDollars, spread },
      href: `/clients/${clientId}/assets/investments`,
      estimatedImpact: excessDollars * spread,
    });
  }

  const pos = portfolio.largestPosition;
  if (pos && portfolio.liquidPortfolio > 0) {
    const share = pos.value / portfolio.liquidPortfolio;
    if (share > CONCENTRATION_WATCH_PCT) {
      out.push({
        id: "portfolio.concentration",
        domain: "portfolio",
        severity: share > CONCENTRATION_CRIT_PCT ? "critical" : "watch",
        title: `${pos.label} is ${Math.round(share * 100)}% of the liquid portfolio`,
        detail: `The largest single position, ${pos.label}, accounts for ${Math.round(share * 100)}% of liquid assets — a single-name risk the plan's return assumptions do not model.`,
        numbers: { share, value: pos.value },
        href: `/clients/${clientId}/assets/investments`,
        estimatedImpact: pos.value - CONCENTRATION_WATCH_PCT * portfolio.liquidPortfolio,
      });
    }
  }

  return out;
}
