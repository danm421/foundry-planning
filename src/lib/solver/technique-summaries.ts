// Pure one-line summaries for technique rows in the solver Techniques tab.

import type {
  RothConversion,
  AssetTransaction,
  Reinvestment,
} from "@/engine/types";

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

export function summarizeReinvestment(ri: Reinvestment): string {
  const groupCount = ri.groupKeys?.length ?? 0;
  const acctCount = ri.accountIds.length;
  const target =
    groupCount > 0
      ? `${groupCount} group${groupCount === 1 ? "" : "s"}`
      : `${acctCount} account${acctCount === 1 ? "" : "s"}`;
  const rate = `${Math.round(ri.newGrowthRate * 100)}%`;
  return `${target} · ${rate} from ${ri.year}`;
}
