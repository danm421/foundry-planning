export const STEP_SLUGS = [
  "household",
  "family",
  "accounts",
  "liabilities",
  "goals",
  "cash-flow",
  "insurance",
  "assumptions",
  "review",
] as const;

export type StepSlug = (typeof STEP_SLUGS)[number];

export type StepStatusKind =
  | "untouched"
  | "in_progress"
  | "complete"
  | "skipped";

export interface StepStatus {
  slug: StepSlug;
  kind: StepStatusKind;
  /** Human-readable list of unfilled required fields. Empty for `complete` and `skipped`. */
  gaps: string[];
}

export interface OnboardingState {
  skippedSteps?: StepSlug[];
  lastStepVisited?: StepSlug;
  /**
   * Set when the advisor saves the wizard's Assumptions step. Every other
   * step has a data-shaped completion signal; Assumptions is entirely
   * defaults-backed — `residenceState` is seeded at client creation and the
   * growth/surplus fields all have DB defaults — so "the advisor looked at
   * this" has to be recorded explicitly.
   */
  assumptionsReviewed?: boolean;
  /**
   * The shared `client_imports` draft for this wizard session (Phase 4).
   * Set lazily when the advisor uploads the first document from any
   * step's import drawer; cleared when that draft is committed/discarded
   * or no longer resolvable.
   */
  activeImportId?: string;
}

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}
