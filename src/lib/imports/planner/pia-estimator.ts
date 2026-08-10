import { BEND_POINTS, DEFAULT_SS_WAGE_BASE } from "@/engine/socialSecurity/constants";
import { estimatePiaMonthly } from "@/engine/socialSecurity/estimatePia";
import type { EstimatePiaToolInput } from "./tools";

/**
 * Binds the engine's pure estimator to the current year's constants so the
 * planner tool can call it with only document-derived inputs. This adapter is
 * why `estimatePia` is injected into the planner rather than imported there:
 * `src/lib/imports/planner/tools.ts` stays free of engine and tax-params
 * imports, and its unit tests need no stubs.
 *
 * The default wage base is a 2026 figure while `BEND_POINTS` are SSA's 2025
 * published values — an intentional pairing, analysed in full in that
 * constant's own comment. Don't restate or "fix" it here.
 */
export function makePiaEstimator(ssWageBase: number = DEFAULT_SS_WAGE_BASE) {
  return (input: EstimatePiaToolInput): number =>
    estimatePiaMonthly({
      highestAnnualSalary: input.highestAnnualSalary,
      yearsEmployed: input.yearsEmployed,
      futureYears: input.futureYears,
      ssWageBase,
      bendPoints: { first: BEND_POINTS.first, second: BEND_POINTS.second },
    });
}
