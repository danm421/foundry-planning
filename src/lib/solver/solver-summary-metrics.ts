// src/lib/solver/solver-summary-metrics.ts
//
// Pure read-only derivations for the Solver KPI row. The funded/tax metrics run
// over a projection's ProjectionYear[] and mirror the Retirement Analysis logic
// so the two tools report the same numbers; `netToHeirsEol` composes the estate
// transfer report and mirrors the Estate Summary's headline figure.

import type { ProjectionYear, ProjectionResult, ClientData } from "@/engine";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";

/** Count of plan years whose liquid portfolio is non-negative (no shortfall). */
export function yearsFullyFunded(years: ProjectionYear[]): number {
  return years.filter((y) => liquidPortfolioTotal(y) >= 0).length;
}

/** Sum of per-year total taxes over the whole projection horizon. */
export function lifetimeTaxes(years: ProjectionYear[]): number {
  return years.reduce((sum, y) => sum + (y.expenses?.taxes ?? 0), 0);
}

/**
 * End-of-life "Net to Heirs" for a projection that carries death events —
 * total dollars reaching heirs at each spouse's projected death year, net of
 * estate taxes & costs. Uses `asOf: "split"`, so it matches the Estate Summary
 * deck's headline `netToHeirsEol` and the two surfaces report the same figure.
 *
 * Requires a `ProjectionResult` from `runProjectionWithEvents` (fetched with
 * `includeEvents: true`); the plain ProjectionYear[] the other KPIs read has no
 * death-event data. Returns null when the projection is absent or the household
 * has no estate data (empty report).
 */
export function netToHeirsEol(
  projection: ProjectionResult | undefined,
  clientData: ClientData,
  ownerNames: { clientName: string; spouseName: string | null },
): number | null {
  if (!projection) return null;
  const report = buildEstateTransferReportData({
    projection,
    asOf: { kind: "split" },
    ordering: "primaryFirst",
    clientData,
    ownerNames,
  });
  if (report.isEmpty) return null;
  return summarizeHousehold(report).netToHeirs;
}
