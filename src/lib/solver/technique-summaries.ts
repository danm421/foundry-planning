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

export function summarizeReinvestment(ri: Reinvestment): string {
  const target = formatReinvestmentScope(ri.groupKeys?.length ?? 0, ri.accountIds.length);
  const rate = `${Math.round(ri.newGrowthRate * 100)}%`;
  return `${target} · ${rate} from ${ri.year}`;
}

export function summarizeRelocation(r: Relocation): string {
  return `${USPS_STATE_NAMES[r.destinationState]} · ${r.year}`;
}
