import type { ImportPayload } from "@/lib/imports/types";
import type { CommitTab } from "@/lib/imports/commit/types";
import type { StepSlug } from "./types";

/**
 * Wizard steps that get an "Import from document" drawer — the steps whose
 * data the extractor supports (see ENTITY_SECTIONS in
 * src/lib/extraction/section-classifier.ts). Household and Assumptions are
 * excluded: no extraction schema for client-level fields or advisor
 * assumptions. Review is a summary step.
 */
export const IMPORT_ELIGIBLE_STEPS = [
  "family",
  "entities",
  "accounts",
  "liabilities",
  "cash-flow",
  "insurance",
  "estate",
] as const;

export type ImportEligibleStep = (typeof IMPORT_ELIGIBLE_STEPS)[number];

export function isImportEligibleStep(slug: StepSlug): slug is ImportEligibleStep {
  return (IMPORT_ELIGIBLE_STEPS as readonly string[]).includes(slug);
}

/**
 * Commit tabs the per-step drawer sends to POST /imports/[importId]/commit.
 * Mirrors ReviewWizard's TAB_TO_COMMIT (review-wizard.tsx) — family commits
 * both clients-identity (filing status) and family-members; cash-flow
 * commits incomes and expenses together.
 */
export const STEP_COMMIT_TABS: Record<ImportEligibleStep, CommitTab[]> = {
  family: ["clients-identity", "family-members"],
  entities: ["entities"],
  accounts: ["accounts"],
  liabilities: ["liabilities"],
  "cash-flow": ["incomes", "expenses"],
  insurance: ["life-insurance"],
  estate: ["wills"],
};

export const STEP_IMPORT_LABEL: Record<ImportEligibleStep, string> = {
  family: "Family",
  entities: "Entities",
  accounts: "Accounts",
  liabilities: "Liabilities",
  "cash-flow": "Income & Expenses",
  insurance: "Insurance",
  estate: "Estate",
};

/**
 * True when the extracted payload contains at least one row for the
 * given step's section — drives the drawer's "jump straight to review"
 * path when attaching to an existing shared draft.
 */
export function stepHasImportData(
  payload: ImportPayload,
  step: ImportEligibleStep,
): boolean {
  switch (step) {
    case "family":
      return (
        Boolean(payload.primary) ||
        Boolean(payload.spouse) ||
        payload.dependents.length > 0
      );
    case "entities":
      return payload.entities.length > 0;
    case "accounts":
      return payload.accounts.length > 0;
    case "liabilities":
      return payload.liabilities.length > 0;
    case "cash-flow":
      return payload.incomes.length > 0 || payload.expenses.length > 0;
    case "insurance":
      return payload.lifePolicies.length > 0;
    case "estate":
      return payload.wills.length > 0;
  }
}
