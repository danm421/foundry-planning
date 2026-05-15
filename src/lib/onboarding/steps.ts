import type { StepSlug } from "./types";

/** Lightweight icon key — resolved to a real SVG in the wizard chrome.
 * Kept as a string here so this module stays framework-free and the
 * step manifest can be imported anywhere (server, client, tests). */
export type StepIconKey =
  | "household"
  | "family"
  | "entities"
  | "accounts"
  | "liabilities"
  | "cash-flow"
  | "insurance"
  | "estate"
  | "assumptions"
  | "review";

export interface StepDef {
  slug: StepSlug;
  label: string;
  /** Short caption rendered under the title in the wizard header. */
  description: string;
  /** Icon key — the shell maps this to an SVG component. */
  icon: StepIconKey;
  /** Whether the advisor can mark this step Skipped and still Finish onboarding. */
  skippable: boolean;
  /** When true, Phase 1 renders a deep-link placeholder instead of an editable form. */
  placeholderInPhase1: boolean;
  /** Deep link to the existing tabbed client-data surface for placeholder steps. */
  tabHref?: (clientId: string) => string;
}

export const STEPS: readonly StepDef[] = [
  {
    slug: "household",
    label: "Household",
    description: "Names, dates of birth, retirement targets, and filing status.",
    icon: "household",
    skippable: false,
    placeholderInPhase1: false,
  },
  {
    slug: "family",
    label: "Family",
    description: "Children, dependents, and any beneficiaries the plan should know about.",
    icon: "family",
    skippable: true,
    placeholderInPhase1: false,
  },
  {
    slug: "entities",
    label: "Entities",
    description: "Trusts, LLCs, and other entities tied to the household.",
    icon: "entities",
    skippable: true,
    placeholderInPhase1: false,
  },
  {
    slug: "accounts",
    label: "Accounts",
    description: "Investment, retirement, and bank accounts on the balance sheet.",
    icon: "accounts",
    skippable: false,
    placeholderInPhase1: false,
  },
  {
    slug: "liabilities",
    label: "Liabilities",
    description: "Mortgages, loans, and other debts.",
    icon: "liabilities",
    skippable: true,
    placeholderInPhase1: false,
  },
  {
    slug: "cash-flow",
    label: "Cash Flow",
    description: "Recurring income and expense streams that drive the projection.",
    icon: "cash-flow",
    skippable: false,
    placeholderInPhase1: false,
  },
  {
    slug: "insurance",
    label: "Insurance",
    description: "Life, disability, and long-term-care coverage.",
    icon: "insurance",
    skippable: true,
    placeholderInPhase1: false,
  },
  {
    slug: "estate",
    label: "Estate",
    description: "Wills, trusts, and the wishes that drive the estate spine.",
    icon: "estate",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/wills`,
  },
  {
    slug: "assumptions",
    label: "Assumptions",
    description: "Inflation, growth rates, and tax assumptions for this plan.",
    icon: "assumptions",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/assumptions`,
  },
  {
    slug: "review",
    label: "Review",
    description: "Confirm the basics and finish onboarding.",
    icon: "review",
    skippable: false,
    placeholderInPhase1: false,
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
