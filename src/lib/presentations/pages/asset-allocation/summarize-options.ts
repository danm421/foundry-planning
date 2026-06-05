import type { AssetAllocationOptions, SourceRef } from "./options-schema";

const VIEW_LABEL: Record<AssetAllocationOptions["view"], string> = {
  high_level: "By type", detailed: "By class", combined: "Combined",
};

function sourceLabel(ref: SourceRef | null): string {
  if (!ref) return "None";
  if (ref.kind === "group") return "Group";
  if (ref.kind === "portfolio") return "Portfolio";
  return "Recommended";
}

export function summarizeAssetAllocationOptions(o: AssetAllocationOptions): string {
  const parts = [`${sourceLabel(o.left)} vs ${sourceLabel(o.right)}`, VIEW_LABEL[o.view]];
  if (o.includeOutOfEstate) parts.push("incl. out-of-estate");
  parts.push(o.showTable ? "with table" : "no table");
  // Excluded accounts show by default; only flag the non-default hidden state.
  if (!o.showExcluded) parts.push("no excluded accounts");
  return parts.join(" · ");
}
