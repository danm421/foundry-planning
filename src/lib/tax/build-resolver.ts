// src/lib/tax/build-resolver.ts
//
// THE one place a tax resolver is built from a plan's settings.
//
// Two surfaces need this: the projection (src/engine/projection.ts) and the
// solver's Thresholds panel (src/lib/solver/threshold-params.ts), which
// resolves its own parameters because ProjectionYear.thresholdFacts omits them.
// They previously duplicated the inflation-rate fallback chain, and
// threshold-params.ts carries a comment warning that any drift displays
// thresholds the engine never applied — silently, with every test green.
// A stressor is one more thing to forget, so the chain lives here once.
//
// Deliberately NOT routed through here: src/lib/tax-returns/load-analysis-context.ts.
// It resolves parameters for ACTUAL FILED RETURNS and must never see a plan's
// hypothetical, so it keeps calling createTaxResolver directly.

import { createTaxResolver, type TaxResolver } from "./resolver";
import type { TaxYearParameters } from "./types";
import type { TaxRateStress } from "./rate-stress";

/** The slice of PlanSettings a resolver needs. Structural on purpose:
 *  `PlanSettings` satisfies it by shape, and not importing the engine type
 *  keeps src/lib/tax free of an engine dependency. */
export interface TaxResolverSettings {
  inflationRate: number;
  taxInflationRate?: number | null;
  ssWageGrowthRate?: number | null;
  taxRateStress?: TaxRateStress;
}

/**
 * Build the resolver for a plan, or null when no `tax_year_parameters` rows
 * are loaded (flat-mode fallback — see projection.ts's own warning).
 */
export function buildTaxResolver(
  rows: TaxYearParameters[] | undefined,
  settings: TaxResolverSettings,
): TaxResolver | null {
  if (rows == null || rows.length === 0) return null;
  return createTaxResolver(
    rows,
    {
      taxInflationRate:
        settings.taxInflationRate != null ? settings.taxInflationRate : settings.inflationRate,
      ssWageGrowthRate:
        settings.ssWageGrowthRate != null
          ? settings.ssWageGrowthRate
          : settings.inflationRate + 0.005,
    },
    settings.taxRateStress,
  );
}
