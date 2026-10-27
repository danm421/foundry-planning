import type { ClientData, ProjectionResult } from "@/engine";
import { endOfLifeYear, estateDistributionAtYear } from "@/lib/estate/estate-distribution-at-year";

export interface EstateImpact {
  /** Estate taxes + admin/probate costs, both deaths added. */
  taxesAndCosts: number;
  /** Total to heirs at the final death — the same figure the KPI strip shows. */
  toHeirs: number | null;
  finalDeathYear: number | null;
}

/** Reads the two numbers the guided trust Review step compares from a
 *  with-events projection. A single client's death is the final death. */
export function estateImpactOf(projection: ProjectionResult, tree: ClientData): EstateImpact {
  const taxesAndCosts =
    (projection.firstDeathEvent?.totalTaxesAndExpenses ?? 0) +
    (projection.secondDeathEvent?.totalTaxesAndExpenses ?? 0);
  const year = endOfLifeYear(projection) ?? null;
  const toHeirs =
    year == null
      ? null
      : estateDistributionAtYear({
          projection,
          year,
          clientData: tree,
          ownerNames: { clientName: tree.client.firstName, spouseName: tree.client.spouseName ?? null },
        }).toHeirs;
  return { taxesAndCosts, toHeirs, finalDeathYear: year };
}
