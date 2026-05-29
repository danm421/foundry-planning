import type { AssetAllocationData } from "./view-model";
/** Donut row + header consume most of page 1; ~20 table rows fit alongside.
 *  Drift adds a chart block. Anything beyond that spills to a second page. */
export function estimateAssetAllocationPageCount(data: AssetAllocationData): number {
  const tableHeavy = data.tableRows.length > 20;
  const hasDrift = data.driftRows !== null && data.driftRows.length > 0;
  return tableHeavy && hasDrift ? 2 : 1;
}
