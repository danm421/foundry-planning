export { runProjection, runProjectionWithEvents } from "./projection";
export type { ProjectionResult, ProjectionOptions } from "./projection";
export { calculateTaxes } from "./tax";
export { computeIncome } from "./income";
export { computeExpenses } from "./expenses";
export { computeLiabilities, amortizeLiability } from "./liabilities";
export { applySavingsRules } from "./savings";
export { executeWithdrawals } from "./withdrawal";
export { calculateRMD, getRmdStartAge, isRmdEligibleSubType } from "./rmd";
export type {
  ClientData,
  ClientInfo,
  Account,
  Income,
  Expense,
  Liability,
  SavingsRule,
  WithdrawalPriority,
  PlanSettings,
  ProjectionYear,
  AccountLedger,
} from "./types";

// ── Monte Carlo ────────────────────────────────────────────────────────────
export { runMonteCarlo } from "./monteCarlo/run";
export type { MonteCarloResult, RunMonteCarloInput } from "./monteCarlo/run";
export { summarizeMonteCarlo, percentiles } from "./monteCarlo/summarize";
export type {
  MonteCarloSummary,
  YearlySummaryRow,
  TerminalDistribution,
  PercentileBundle,
  SummarizeOptions,
} from "./monteCarlo/summarize";
export { createReturnEngine } from "./monteCarlo/returns";
export type { ReturnEngine, ReturnEngineInput, IndexInput } from "./monteCarlo/returns";
export { buildCorrelationMatrix, canonicalPair } from "./monteCarlo/correlation-matrix";
export type { CorrelationRow } from "./monteCarlo/correlation-matrix";
export { runTrial, liquidPortfolioTotal } from "./monteCarlo/trial";
export type { TrialResult, RunTrialInput, AccountAssetMix } from "./monteCarlo/trial";
