/**
 * Precise definition of `MonteCarloSummary.failureRate`, which counts BOTH of
 * the engine's checks (see classifyTrial in src/engine/monteCarlo/trial.ts):
 * a dip below $0 in any simulated year, OR an ending balance under the plan's
 * minimum asset level.
 *
 * TerminalHistogram's own below-minimum count is a DIFFERENT, ending-only
 * number with an inclusive boundary. Never label the two the same.
 */
export const SHORTFALL_RISK_TOOLTIP =
  "The share of simulated trials where the portfolio went negative in any year, or ended below the plan's minimum asset level.";

export function shortfallFootnote(failCount: number, trialsRun: number): string {
  return `${failCount.toLocaleString()} of ${trialsRun.toLocaleString()} trials fell short`;
}
