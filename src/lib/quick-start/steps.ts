// src/lib/quick-start/steps.ts
export const QS_STEPS = [
  { slug: "basics", label: "Basics" },
  { slug: "income", label: "Income" },
  { slug: "expenses", label: "Expenses" },
  { slug: "accounts", label: "Accounts" },
  { slug: "savings", label: "Savings" },
  { slug: "insurance", label: "Life insurance" },
  { slug: "assumptions", label: "Assumptions" },
] as const;

export type QsStepSlug = (typeof QS_STEPS)[number]["slug"];
/** The steps that live inside /quick-start (Basics is the /clients/new form). */
export const QS_WIZARD_STEPS = QS_STEPS.filter((s) => s.slug !== "basics");

export function qsStepIndex(slug: QsStepSlug): number {
  return QS_STEPS.findIndex((s) => s.slug === slug);
}
export function qsNextSlug(slug: QsStepSlug): QsStepSlug | null {
  const i = qsStepIndex(slug);
  return i < 0 || i >= QS_STEPS.length - 1 ? null : QS_STEPS[i + 1].slug;
}
export function qsPrevSlug(slug: QsStepSlug): QsStepSlug | null {
  const i = qsStepIndex(slug);
  return i <= 0 ? null : QS_STEPS[i - 1].slug;
}
