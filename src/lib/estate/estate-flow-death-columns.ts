import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";
import type { AsOfSelection, DeathSectionData } from "@/lib/estate/transfer-report";

/**
 * Translate the Estate Flow death-column as-of dropdown value into the
 * `AsOfSelection` shape `buildEstateTransferReportData` expects. Mirrors the
 * mapping the estate-transfer and estate-tax report views use.
 */
export function asOfSelectionFor(asOf: AsOfValue): AsOfSelection {
  if (asOf === "today") return { kind: "today" };
  if (asOf === "split") return { kind: "split" };
  return { kind: "year", year: asOf };
}

/**
 * Decide which death section feeds report column 2 vs column 3.
 *
 * In "split" mode the death-order toggle cosmetically swaps the two columns —
 * the projection still has a single fixed death order, so spouse-first just
 * re-orders what the advisor sees. In the hypothetical "today" / "year" modes
 * `buildEstateTransferReportData`'s `pickOrdering` has already placed the
 * requested decedent in `firstDeath`, so swapping again would double-apply the
 * ordering. Hence the swap is gated to split mode.
 */
export function pickDeathColumns(
  reportData: {
    firstDeath: DeathSectionData | null;
    secondDeath: DeathSectionData | null;
  },
  asOf: AsOfValue,
  ordering: "primaryFirst" | "spouseFirst",
): [DeathSectionData | null, DeathSectionData | null] {
  if (asOf === "split" && ordering === "spouseFirst") {
    return [reportData.secondDeath, reportData.firstDeath];
  }
  return [reportData.firstDeath, reportData.secondDeath];
}
