// Which presentation pages imply expensive per-scenario work.
//
// These live in one pure module because BOTH the export route
// (`components/presentations/render-presentation-pdf.ts`) and the Forge
// `generate_report` tool (`domain/forge/tools/report.ts`) plan against them, and
// they previously kept independent copies — the same drift that let the fan-out
// caps disagree until they were unified in `lib/scenario/presentation-refs.ts`.
// Registering a page in one copy and not the other silently changes what a deck
// contains: the tool refuses a deck the route would render, or a sheet renders
// with its Monte Carlo figures and change lines blank.
//
// No Next, no DB, no registry import — so a test can pin a page's registration
// without standing up the export's IO.

/** Pages that require a server-side Monte Carlo run for their scenario. The
 *  Monte Carlo page renders the full simulation; the Retirement Summary needs it
 *  only for its Monte Carlo KPI; the comparison pages need one per column.
 *  Runs are deduped per distinct scenario in `planScenarioBundles`. */
export const MONTE_CARLO_PAGE_IDS: ReadonlySet<string> = new Set([
  "monteCarlo",
  "retirementSummary",
  "retirementComparison",
  "scenarioComparison",
]);

/** Pages that READ `bundle.scenarioChanges` — a live scenario's stored change
 *  set. (The `retirementComparison` entry is pre-existing and dead: its AI path
 *  loads its own change set. Left alone.) */
export const SCENARIO_CHANGES_PAGE_IDS: ReadonlySet<string> = new Set([
  "scenarioChanges",
  "retirementComparison",
  "scenarioComparison",
]);

/** The planner flags a page id implies. The export route builds every
 *  `PlannerPage` from this, so a test asserting on it is asserting on the same
 *  registration the render actually reads. */
export function plannerFlagsFor(pageId: string): {
  needsMonteCarloRun: boolean;
  isScenarioChanges: boolean;
} {
  return {
    needsMonteCarloRun: MONTE_CARLO_PAGE_IDS.has(pageId),
    isScenarioChanges: SCENARIO_CHANGES_PAGE_IDS.has(pageId),
  };
}
