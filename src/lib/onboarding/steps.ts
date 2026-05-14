import type { StepSlug } from "./types";

export interface StepDef {
  slug: StepSlug;
  label: string;
  /** Whether the advisor can mark this step Skipped and still Finish onboarding. */
  skippable: boolean;
  /** When true, Phase 1 renders a deep-link placeholder instead of an editable form. */
  placeholderInPhase1: boolean;
  /** Deep link to the existing tabbed client-data surface for placeholder steps. */
  tabHref?: (clientId: string) => string;
}

export const STEPS: readonly StepDef[] = [
  { slug: "household", label: "Household", skippable: false, placeholderInPhase1: false },
  { slug: "family", label: "Family", skippable: true, placeholderInPhase1: false },
  {
    slug: "entities",
    label: "Entities",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/family`,
  },
  {
    slug: "accounts",
    label: "Accounts",
    skippable: false,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/balance-sheet`,
  },
  {
    slug: "liabilities",
    label: "Liabilities",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/balance-sheet`,
  },
  {
    slug: "cash-flow",
    label: "Cash Flow",
    skippable: false,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/income-expenses`,
  },
  {
    slug: "insurance",
    label: "Insurance",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/insurance`,
  },
  {
    slug: "estate",
    label: "Estate",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/wills`,
  },
  {
    slug: "assumptions",
    label: "Assumptions",
    skippable: true,
    placeholderInPhase1: true,
    tabHref: (id) => `/clients/${id}/client-data/assumptions`,
  },
  { slug: "review", label: "Review", skippable: false, placeholderInPhase1: false },
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
