import type { ProjectionYear } from "@/engine/types";

/**
 * The "Age" cell for a projection-year row: `"67"` solo, `"67 / 65"` married.
 * A member past their life expectancy reads `"—"` — the projection keeps
 * running to the longer-lived spouse's horizon, so the row still exists but
 * that person's age is no longer meaningful. Missing life expectancy falls back
 * to 95, the planner's own default.
 *
 * Extracted here for the Solver's Income report. The `tax-detail-*` tables in
 * this directory each still carry a private, byte-identical copy predating this
 * module — converging them is a safe follow-up, not part of that feature.
 */
export function formatProjectionAges(
  ages: ProjectionYear["ages"],
  clientLifeExpectancy?: number,
  spouseLifeExpectancy?: number | null,
): string {
  const clientLE = clientLifeExpectancy ?? 95;
  const spouseLE = spouseLifeExpectancy ?? 95;
  const client = ages.client > clientLE ? "—" : String(ages.client);
  if (ages.spouse == null) return client;
  const spouse = ages.spouse > spouseLE ? "—" : String(ages.spouse);
  return `${client} / ${spouse}`;
}
