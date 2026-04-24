export const MC_WARN_THRESHOLD = 0.75;
export const MC_CRIT_THRESHOLD = 0.60;
export const LIQUIDITY_RUNWAY_MIN_YEARS = 3;
export const STALE_CLIENT_DATA_DAYS = 90;

export type AlertSeverity = "warning" | "critical";

export type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href?: string;
};

type ClientLike = { id: string; updatedAt: string | Date };
type ProjectionLike = {
  monteCarloSuccess: number | null;
  liquidPortfolio: number;
  currentYearNetOutflow: number; // positive = outflow > inflow
  minNetWorth: number; // smallest projected year-end NW across plan
};

export function computeAlerts(client: ClientLike, projection: ProjectionLike): Alert[] {
  const out: Alert[] = [];

  // 1. Monte Carlo below threshold
  const mc = projection.monteCarloSuccess;
  if (mc != null && mc < MC_WARN_THRESHOLD) {
    out.push({
      id: "mc-below-threshold",
      severity: mc < MC_CRIT_THRESHOLD ? "critical" : "warning",
      title: `Monte Carlo success ${Math.round(mc * 100)}%`,
      detail: `Below ${Math.round(MC_WARN_THRESHOLD * 100)}% confidence threshold.`,
      href: `/clients/${client.id}/monte-carlo`,
    });
  }

  // 2. Liquidity runway
  if (projection.currentYearNetOutflow > 0) {
    const runway = projection.liquidPortfolio / projection.currentYearNetOutflow;
    if (runway < LIQUIDITY_RUNWAY_MIN_YEARS) {
      out.push({
        id: "liquidity-runway-low",
        severity: "warning",
        title: `Liquidity runway ${runway.toFixed(1)}y`,
        detail: `Under ${LIQUIDITY_RUNWAY_MIN_YEARS}y of projected net outflow covered by liquid portfolio.`,
        href: `/clients/${client.id}/cashflow`,
      });
    }
  }

  // 3. Projected NW hits zero
  if (projection.minNetWorth <= 0) {
    out.push({
      id: "negative-net-worth-projected",
      severity: "critical",
      title: "Plan goes negative",
      detail: "At least one projected year shows net worth ≤ $0.",
      href: `/clients/${client.id}/timeline`,
    });
  }

  // 4. Stale client data
  const updated = new Date(client.updatedAt).getTime();
  const ageDays = (Date.now() - updated) / 86400000;
  if (ageDays > STALE_CLIENT_DATA_DAYS) {
    out.push({
      id: "stale-client-data",
      severity: "warning",
      title: `Details ${Math.floor(ageDays)}d stale`,
      detail: `Client data hasn't been updated in over ${STALE_CLIENT_DATA_DAYS} days.`,
      href: `/clients/${client.id}/client-data`,
    });
  }

  return out;
}
