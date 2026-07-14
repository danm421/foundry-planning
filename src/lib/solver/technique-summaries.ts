// Pure one-line summaries for technique rows in the solver Techniques tab.

import type {
  RothConversion,
  AssetTransaction,
  Reinvestment,
  Relocation,
} from "@/engine/types";
import { USPS_STATE_NAMES } from "@/lib/usps-states";

const usd = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function summarizeRothConversion(rc: RothConversion): string {
  const window = rc.endYear ? `${rc.startYear}–${rc.endYear}` : `${rc.startYear}`;
  switch (rc.conversionType) {
    case "fixed_amount":
      return `${usd(rc.fixedAmount)}/yr · ${window}`;
    case "full_account":
      return `Full account · ${rc.startYear}`;
    case "deplete_over_period":
      return `Deplete over ${window}`;
    case "fill_up_bracket":
      return `Fill ${Math.round((rc.fillUpBracket ?? 0) * 100)}% bracket · ${window}`;
  }
}

export function summarizeAssetTransaction(at: AssetTransaction): string {
  const verb = at.type === "buy" ? "Buy" : "Sell";
  const label = at.type === "buy" ? (at.assetName ?? at.name) : at.name;
  return `${verb} · ${label} · ${at.year}`;
}

export function formatReinvestmentScope(groupCount: number, accountCount: number): string {
  return groupCount > 0
    ? `${groupCount} ${groupCount === 1 ? "group" : "groups"}`
    : `${accountCount} ${accountCount === 1 ? "account" : "accounts"}`;
}

export function summarizeReinvestment(
  ri: Reinvestment,
  portfolioGrowthById?: Map<string, number>,
): string {
  const target = formatReinvestmentScope(ri.groupKeys?.length ?? 0, ri.accountIds.length);
  const rate = `${Math.round(reinvestmentDisplayRate(ri, portfolioGrowthById) * 100)}%`;
  return `${target} · ${rate} from ${ri.year}`;
}

/** The rate to show in the chip. Prefers the server-resolved `newGrowthRate`;
 *  for a freshly-added reinvestment (newGrowthRate still 0) it derives the rate
 *  from the raw inputs — the target portfolio's growth rate or the custom rate. */
function reinvestmentDisplayRate(
  ri: Reinvestment,
  portfolioGrowthById?: Map<string, number>,
): number {
  if (ri.newGrowthRate) return ri.newGrowthRate;
  if (ri.targetType === "model_portfolio" && ri.modelPortfolioId) {
    return portfolioGrowthById?.get(ri.modelPortfolioId) ?? 0;
  }
  if (ri.targetType === "custom") return ri.customGrowthRate ?? 0;
  return 0;
}

export function summarizeRelocation(r: Relocation): string {
  return `${USPS_STATE_NAMES[r.destinationState]} · ${r.year}`;
}

export function summarizeSurplusAllocation({
  spendPct,
  saveAccountName,
}: {
  spendPct: number;
  saveAccountName?: string | null;
}): string {
  const pct = Math.round(spendPct * 100);
  return `Spend ${pct}% · save rest to ${saveAccountName ?? "household checking"}`;
}
