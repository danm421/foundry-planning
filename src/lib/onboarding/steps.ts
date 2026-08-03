import type { StepSlug } from "./types";

/** Lightweight icon key — resolved to a real SVG in the wizard chrome.
 * Kept as a string here so this module stays framework-free and the
 * step manifest can be imported anywhere (server, client, tests). */
export type StepIconKey =
  | "household"
  | "family"
  | "accounts"
  | "liabilities"
  | "goals"
  | "cash-flow"
  | "insurance"
  | "assumptions"
  | "review";

export interface StepDef {
  slug: StepSlug;
  label: string;
  /** Short caption rendered under the title in the wizard header. */
  description: string;
  /** Icon key — the shell maps this to an SVG component. */
  icon: StepIconKey;
}

export const STEPS: readonly StepDef[] = [
  {
    slug: "household",
    label: "Household",
    description: "Names, dates of birth, retirement targets, and filing status.",
    icon: "household",
  },
  {
    slug: "family",
    label: "Family",
    description: "Children, dependents, and any beneficiaries the plan should know about.",
    icon: "family",
  },
  {
    slug: "accounts",
    label: "Assets",
    description: "Investment, retirement, and bank accounts on the balance sheet.",
    icon: "accounts",
  },
  {
    slug: "liabilities",
    label: "Liabilities",
    description: "Mortgages, loans, and other debts.",
    icon: "liabilities",
  },
  {
    slug: "goals",
    label: "Goals",
    description: "Education funding and other goals the plan should track on their own.",
    icon: "goals",
  },
  {
    slug: "cash-flow",
    label: "Cash Flow",
    description: "Recurring income and expense streams that drive the projection.",
    icon: "cash-flow",
  },
  {
    slug: "insurance",
    label: "Insurance",
    description: "Life, disability, and long-term-care coverage.",
    icon: "insurance",
  },
  {
    slug: "assumptions",
    label: "Assumptions",
    description: "Inflation, growth rates, and tax assumptions for this plan.",
    icon: "assumptions",
  },
  {
    slug: "review",
    label: "Review",
    description: "Confirm the basics and finish onboarding.",
    icon: "review",
  },
];

export function stepIndex(slug: StepSlug): number {
  return STEPS.findIndex((s) => s.slug === slug);
}

export function nextStep(slug: StepSlug): StepSlug | null {
  const i = stepIndex(slug);
  if (i < 0 || i >= STEPS.length - 1) return null;
  return STEPS[i + 1].slug;
}

export function prevStep(slug: StepSlug): StepSlug | null {
  const i = stepIndex(slug);
  if (i <= 0) return null;
  return STEPS[i - 1].slug;
}
