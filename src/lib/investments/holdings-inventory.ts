// src/lib/investments/holdings-inventory.ts
import { holdingMarketValue } from "./holdings-rollup";

/** The subset of an enriched/raw holding row this view reads. Decimal columns
 *  arrive as strings from Drizzle; dates as `YYYY-MM-DD` strings. An enriched
 *  row (load-enriched-holdings) is a structural superset, so it can be passed
 *  here directly. */
export interface HoldingRowInput {
  id: string;
  displayTicker: string | null;
  displayName: string | null;
  shares: string;
  price: string;
  priceAsOf: string | null;
  costBasis: string;
  marketValue: string | null;
}

export interface HoldingLite {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  price: number;
  priceAsOf: string | null;
  marketValue: number;
  pctOfTotal: number;
  costBasis: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
}

export interface AccountMeta {
  name: string;
  category: string;
}

export interface AccountHoldingsGroup {
  accountId: string;
  accountName: string;
  category: string;
  totalValue: number;
  pctOfTotal: number;
  holdings: HoldingLite[];
}

const posMv = (mv: number) => (Number.isFinite(mv) && mv > 0 ? mv : 0);

/** Shape enriched holding rows into per-account groups. Pure + unit-testable.
 *  `pctOfTotal` always uses the grand total of ALL holdings so percentages are
 *  identical whether viewed by-account or all-at-once. Accounts with no rows
 *  are omitted; groups are sorted by totalValue desc. */
export function buildHoldingsInventory(
  enrichedByAccount: ReadonlyMap<string, readonly HoldingRowInput[]>,
  acctMeta: ReadonlyMap<string, AccountMeta>,
): AccountHoldingsGroup[] {
  // Pass 1: parse rows + per-holding MV; accumulate the grand total.
  let grandTotal = 0;
  const staged: {
    accountId: string;
    parsed: { row: HoldingRowInput; shares: number; price: number; mv: number; costBasis: number | null }[];
  }[] = [];

  for (const [accountId, rows] of enrichedByAccount) {
    if (rows.length === 0) continue;
    const parsed = rows.map((row) => {
      const shares = Number(row.shares);
      const price = Number(row.price);
      const mvRaw = row.marketValue != null ? Number(row.marketValue) : null;
      const mv = holdingMarketValue({ marketValue: mvRaw, shares, price });
      const cbRaw = Number(row.costBasis);
      const costBasis = Number.isFinite(cbRaw) && cbRaw > 0 ? cbRaw : null;
      grandTotal += posMv(mv);
      return { row, shares, price, mv, costBasis };
    });
    staged.push({ accountId, parsed });
  }

  const pct = (v: number) => (grandTotal > 0 ? v / grandTotal : 0);

  const groups: AccountHoldingsGroup[] = staged.map(({ accountId, parsed }) => {
    const meta = acctMeta.get(accountId);
    const holdings: HoldingLite[] = parsed.map(({ row, shares, price, mv, costBasis }) => ({
      id: row.id,
      ticker: row.displayTicker ?? "",
      name: row.displayName ?? "",
      shares,
      price,
      priceAsOf: row.priceAsOf,
      marketValue: mv,
      pctOfTotal: pct(mv),
      costBasis,
      gainLoss: costBasis != null ? mv - costBasis : null,
      gainLossPct: costBasis != null && costBasis > 0 ? (mv - costBasis) / costBasis : null,
    }));
    const totalValue = parsed.reduce((s, r) => s + posMv(r.mv), 0);
    return {
      accountId,
      accountName: meta?.name ?? "Unknown account",
      category: meta?.category ?? "",
      totalValue,
      pctOfTotal: pct(totalValue),
      holdings,
    };
  });

  groups.sort((a, b) => b.totalValue - a.totalValue);
  return groups;
}
