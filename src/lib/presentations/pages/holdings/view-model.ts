import {
  flattenInventory,
  sortFlatHoldings,
  type HoldingLite,
} from "@/lib/investments/holdings-inventory";
import { exactCurrency } from "@/lib/presentations/format";
import type {
  BuildHoldingsInput,
  HoldingsPageData,
  HoldingRowVm,
} from "./types";

// Formatting parity with the app's Holdings tab (holdings-tab.tsx), pinned to
// en-US so server-side PDF rendering is deterministic. Formatters are hoisted —
// they run once per holding row per deck render.
const USD2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SHARES = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const usd2 = (n: number) => USD2.format(n);
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const sharesFmt = (n: number) => SHARES.format(n);

function rowVm(h: HoldingLite): HoldingRowVm {
  let gainLoss: HoldingRowVm["gainLoss"] = null;
  if (h.gainLoss != null) {
    const sign = h.gainLoss > 0 ? "+" : "";
    const pctPart =
      h.gainLossPct != null ? ` (${sign}${(h.gainLossPct * 100).toFixed(1)}%)` : "";
    gainLoss = {
      text: `${sign}${exactCurrency(h.gainLoss)}${pctPart}`,
      tone: h.gainLoss > 0 ? "good" : h.gainLoss < 0 ? "crit" : "neutral",
    };
  }
  return {
    ticker: h.ticker,
    name: h.name,
    shares: sharesFmt(h.shares),
    price: usd2(h.price),
    marketValue: exactCurrency(h.marketValue),
    pctOfTotal: pct1(h.pctOfTotal),
    costBasis: h.costBasis == null ? null : exactCurrency(h.costBasis),
    gainLoss,
  };
}

export function buildHoldingsData(input: BuildHoldingsInput): HoldingsPageData {
  const groups = input.holdings ?? [];
  const totalValue = groups.reduce((s, g) => s + g.totalValue, 0);
  const positionCount = groups.reduce((s, g) => s + g.holdings.length, 0);
  const base = {
    title: "Holdings",
    subtitle: `As of ${input.reportDate}`,
    totalValue: exactCurrency(totalValue),
    accountCount: groups.length,
    positionCount,
    includeCostBasis: input.options.includeCostBasis,
  };

  if (input.options.groupByAccount) {
    return {
      ...base,
      accountBlocks: groups.map((g) => ({
        accountName: g.accountName,
        category: g.category,
        totalValue: exactCurrency(g.totalValue),
        pctOfTotal: pct1(g.pctOfTotal),
        rows: g.holdings.map(rowVm),
      })),
      flatRows: null,
    };
  }

  const flat = sortFlatHoldings(flattenInventory(groups), "marketValue", "desc");
  return {
    ...base,
    accountBlocks: null,
    flatRows: flat.map((h) => ({ ...rowVm(h), accountName: h.accountName })),
  };
}
