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
  return estateHeirTotalsEol(projection, clientData, ownerNames)?.netToHeirs ?? null;
}

/** What reaches the heirs, and the income tax already taken out of it. */
export interface EstateHeirTotals {
  /** Same figure `netToHeirsEol` returns. */
  netToHeirs: number;
  /**
   * Income tax the heirs owe on inherited pre-tax retirement balances — income
   * in respect of a decedent — already deducted from `netToHeirs`.
   *
   * Zero is a REAL answer, not a missing one: it means the household's estate
   * holds no pre-tax balances at death, or that no IRD tax rate has been set
   * (see death-warning-summary.ts, which warns on exactly that). Anything
   * telling the client this tax was accounted for has to read the figure, not
   * assume it.
   */
  heirIncomeTax: number;
}

/**
 * The end-of-life estate split, from ONE report build. `netToHeirsEol` is the
 * netToHeirs half of it, so a caller that wants both figures gets them without
 * composing the (multi-query, whole-projection) report twice.
 *
 * ⚠️ That saving is available, not taken: the Scenario Comparison AI path reads
 * `netToHeirs` through the view model and then calls this again per column for
 * the IRD figure, because the view model returns the page's render contract and
 * nothing on the sheet prints an IRD row. Deliberate — see the call site in
 * `scenario-comparison/generate-ai.ts` — and worth revisiting if a third caller
 * ever needs the pair.
 */
export function estateHeirTotalsEol(
  projection: ProjectionResult | undefined,
  clientData: ClientData,
  ownerNames: { clientName: string; spouseName: string | null },
): EstateHeirTotals | null {
  if (!projection) return null;
  const report = buildEstateTransferReportData({
    projection,
    asOf: { kind: "split" },
    ordering: "primaryFirst",
    clientData,
    ownerNames,
  });
  if (report.isEmpty) return null;
  const household = summarizeHousehold(report);
  return { netToHeirs: household.netToHeirs, heirIncomeTax: household.ird };
}

/**
 * Liquid portfolio total at a specific projection year — the same measure the
 * Ending Portfolio Assets KPI and the portfolio bar chart use
 * (`portfolioAssets.liquidTotal` = taxable + cash + retirement + life insurance
 * + accessible trust assets), sampled at `year` instead of the last row.
 * Returns null when no projection year matches `year` (e.g. the year precedes
 * the projection because the client is already retired, or falls beyond the
 * plan horizon).
 */
export function portfolioAtYear(years: ProjectionYear[], year: number): number | null {
  const row = years.find((y) => y.year === year);
  return row ? row.portfolioAssets.liquidTotal : null;
}
