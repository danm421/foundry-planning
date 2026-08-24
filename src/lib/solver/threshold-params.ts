/**
 * Pure resolver for the `TaxYearParameters` the Thresholds report needs. Not
 * inlined into the panel: pure + framework-free, same rationale as
 * report-layout.ts (imported by a client component; testable without
 * dragging React into the test).
 *
 * `ProjectionYear.thresholdFacts` deliberately omits `params` (see
 * src/engine/types.ts), so the panel has to resolve its own
 * `TaxYearParameters` from the working tree's `taxYearRows`. This uses
 * `buildTaxResolver` exactly as the engine does.
 */
import type { ClientData } from "@/engine/types";
import type { TaxYearParameters } from "@/lib/tax/types";
import { buildTaxResolver } from "@/lib/tax/build-resolver";

/**
 * Resolve `year`'s `TaxYearParameters` from `tree.taxYearRows`.
 *
 * Goes through `buildTaxResolver` — the same factory the projection uses — so
 * the inflation-rate fallback chain and the "tax rates rise" stressor cannot
 * drift between the two. That drift is the failure this file's history warns
 * about: a panel showing thresholds the engine never applied, silently, with
 * every test green.
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
  const resolver = buildTaxResolver(tree.taxYearRows, tree.planSettings);
  return resolver == null ? null : resolver.getYear(year).params;
}
