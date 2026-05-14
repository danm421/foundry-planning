export const STEP_SLUGS = [
  "household",
  "family",
  "entities",
  "accounts",
  "liabilities",
  "cash-flow",
  "insurance",
  "estate",
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
}

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}
