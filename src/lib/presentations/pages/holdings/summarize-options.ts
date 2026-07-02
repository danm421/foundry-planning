import type { HoldingsPageOptions } from "./options-schema";

export function summarizeHoldingsOptions(o: HoldingsPageOptions): string {
  const parts = [o.groupByAccount ? "By account" : "All holdings"];
  if (o.includeCostBasis) parts.push("cost basis");
  return parts.join(" · ");
}
