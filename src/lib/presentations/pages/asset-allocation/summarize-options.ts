import type { AssetAllocationOptions } from "./options-schema";
const VIEW_LABEL: Record<AssetAllocationOptions["view"], string> = {
  high_level: "By type", detailed: "By class", combined: "Combined",
};
export function summarizeAssetAllocationOptions(o: AssetAllocationOptions): string {
  const parts = [VIEW_LABEL[o.view]];
  if (o.includeOutOfEstate) parts.push("incl. out-of-estate");
  parts.push(o.showTable ? "with table" : "no table");
  return parts.join(" · ");
}
