/**
 * Pure resolver for the `TaxYearParameters` the Thresholds report needs. Not
 * inlined into the panel: pure + framework-free, same rationale as
 * report-layout.ts (imported by a client component; testable without
 * dragging React into the test).
 *
 * `ProjectionYear.thresholdFacts` deliberately omits `params` (see
 * src/engine/types.ts), so the panel has to resolve its own
 * `TaxYearParameters` from the working tree's `taxYearRows`. This uses
 * `createTaxResolver` exactly as the engine does.
 */
import type { ClientData } from "@/engine/types";
import type { TaxYearParameters } from "@/lib/tax/types";
import { createTaxResolver } from "@/lib/tax/resolver";

/**
 * Resolve `year`'s `TaxYearParameters` from `tree.taxYearRows`.
 *
 * The inflation-rate fallback chain here MUST match the engine's, at
 * src/engine/projection.ts:452-459, exactly. If this drifts from that
 * chain, the report will display thresholds the engine did not actually
 * apply to the projection — silently, with every test still green.
 *
 * Returns `null` when `taxYearRows` is missing or empty — the flat-mode
 * fallback path (bracket tax mode selected but no `tax_year_parameters`
 * rows loaded; see projection.ts's own warning + fallback). There is no
 * `TaxYearParameters` to resolve in that case.
 */
export function resolveThresholdParams(
  tree: ClientData,
  year: number,
): TaxYearParameters | null {
  const rows = tree.taxYearRows;
  if (rows == null || rows.length === 0) return null;

  const { planSettings } = tree;
  const resolver = createTaxResolver(rows, {
    taxInflationRate:
      planSettings.taxInflationRate != null
        ? planSettings.taxInflationRate
        : planSettings.inflationRate,
    ssWageGrowthRate:
      planSettings.ssWageGrowthRate != null
        ? planSettings.ssWageGrowthRate
        : planSettings.inflationRate + 0.005,
  });
  return resolver.getYear(year).params;
}
