// The portal's per-position projection — the wire shape the Investments page
// and the Accounts drawer's Holdings tab both read. One mapper so the two
// surfaces can never disagree about what a position is worth.
import { holdingMarketValue, reportedCostBasis } from "@/lib/investments/holdings-rollup";
import type { PortalHolding } from "@/lib/portal/contracts";

/**
 * The `account_holdings` columns the projection reads. Structural rather than
 * the Drizzle row type so this stays testable without standing up the schema —
 * and so callers can pass enriched rows, which are a superset.
 */
export interface HoldingProjectionRow {
  displayTicker: string | null;
  displayName: string | null;
  shares: string | number;
  price: string | number;
  marketValue: string | number | null;
  costBasis: string | number | null;
}

/** Positions largest-first — the order every portal holdings list renders in. */
export function toPortalHoldings(rows: readonly HoldingProjectionRow[]): PortalHolding[] {
  return rows
    .map((h) => ({
      ticker: h.displayTicker,
      name: h.displayName ?? h.displayTicker ?? "—",
      shares: Number(h.shares),
      price: Number(h.price),
      marketValue: holdingMarketValue({
        marketValue: h.marketValue != null ? Number(h.marketValue) : null,
        shares: Number(h.shares),
        price: Number(h.price),
      }),
      costBasis: reportedCostBasis(h.costBasis),
    }))
    .sort((x, y) => y.marketValue - x.marketValue);
}
