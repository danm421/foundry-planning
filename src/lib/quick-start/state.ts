import { QS_STEPS, QS_WIZARD_STEPS, type QsStepSlug } from "@/lib/quick-start/steps";

export interface QuickStartState {
  /** Wizard step the advisor last viewed — the resume point. */
  lastStepVisited?: QsStepSlug;
  /** ISO timestamp set when the advisor finishes the wizard. */
  completedAt?: string;
  /** ISO timestamp set when the advisor dismisses the resume banner. */
  dismissedAt?: string;
}

export interface QuickStartPatch {
  lastStepVisited?: string;
  completed?: boolean;
  dismissed?: boolean;
}

const WIZARD_SLUGS = new Set<string>(QS_WIZARD_STEPS.map((s) => s.slug));

/** True for the in-route wizard steps (income…assumptions); false for "basics". */
export function isQsWizardStep(v: unknown): v is QsStepSlug {
  return typeof v === "string" && WIZARD_SLUGS.has(v);
}

/** The single visibility rule, used by both the banner and the dropdown. */
export function quickStartResumeStep(
  state: QuickStartState | null | undefined,
): QsStepSlug | null {
  if (!state?.lastStepVisited) return null;
  if (state.completedAt || state.dismissedAt) return null;
  return isQsWizardStep(state.lastStepVisited) ? state.lastStepVisited : null;
}

/**
 * Pure merge of a patch into the current state. Recording a step re-engages the
 * wizard, so it clears any prior dismissal. `nowIso` is injected so this stays
 * pure and unit-testable.
 */
export function mergeQuickStartState(
  current: QuickStartState,
  patch: QuickStartPatch,
  nowIso: string,
): QuickStartState {
  const next: QuickStartState = { ...current };
  if (patch.lastStepVisited && isQsWizardStep(patch.lastStepVisited)) {
    next.lastStepVisited = patch.lastStepVisited;
    delete next.dismissedAt;
  }
  if (patch.completed) next.completedAt = nowIso;
  if (patch.dismissed) next.dismissedAt = nowIso;
  return next;
}

/** Human label for a step slug (e.g. "insurance" → "Life insurance"). */
export function qsStepLabel(slug: QsStepSlug): string {
  return QS_STEPS.find((s) => s.slug === slug)?.label ?? slug;
}
