/** The right-pane report views (five charts + the summaries deck). */
export type ReportKey = "portfolio" | "cashflow" | "taxBracket" | "lifeInsurance" | "estate" | "summaries";

/** The five left-pane input tabs. */
export type InputTab = "retirement" | "techniques" | "stress_test" | "life_insurance" | "estate_planning";

/**
 * Default report shown on the right when a left input tab is selected.
 * The advisor can override by clicking a report tab; the override holds until
 * the next input-tab change (handled in the workspace, not here).
 */
export function defaultReportForTab(tab: InputTab): ReportKey {
  switch (tab) {
    case "life_insurance":
      return "lifeInsurance";
    case "estate_planning":
      return "estate";
    case "retirement":
    case "techniques":
    case "stress_test": // stress tests read against the Cash Flow / MC PoS report
    default:
      return "portfolio";
  }
}
