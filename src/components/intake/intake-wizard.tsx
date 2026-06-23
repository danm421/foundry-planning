"use client";

import { useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { WizardChrome } from "@/components/wizard-chrome";
import { WelcomeScreen } from "./welcome-screen";
import { FamilyStep } from "./steps/family-step";
import { AccountsStep } from "./steps/accounts-step";
import { IncomeStep } from "./steps/income-step";
import { PropertyStep } from "./steps/property-step";
import { GoalsStep } from "./steps/goals-step";
import { ReviewStep } from "./review-step";

// ─── Public interface ────────────────────────────────────────────────────────
export interface IntakeWizardProps {
  value: IntakeDraft;
  onChange: (next: IntakeDraft) => void;
  onSubmit: () => Promise<void>;
  mode: "blank" | "prefilled";
  busy?: boolean;
  error?: string | null;
}

// ─── Section / sub-step state machine ───────────────────────────────────────
// Flat ordered list of all steps the wizard traverses:
//   welcome → family → assets:accounts → assets:income → assets:property → goals → review

interface StepDescriptor {
  section: "welcome" | "family" | "assets" | "goals" | "review";
  subStep?: "accounts" | "income" | "property";
  /** Chrome label (shown in progress bar + eyebrow) */
  label: string;
  /** H1 shown inside WizardChrome */
  title: string;
  /** Income + Property are optional; family is required */
  skipable?: boolean;
}

const STEPS: readonly StepDescriptor[] = [
  { section: "welcome", label: "Welcome", title: "Welcome" },
  { section: "family",  label: "Family",   title: "Family" },
  { section: "assets",  subStep: "accounts", label: "Accounts", title: "Accounts" },
  { section: "assets",  subStep: "income",   label: "Income",   title: "Income", skipable: true },
  { section: "assets",  subStep: "property", label: "Property", title: "Property", skipable: true },
  { section: "goals",   label: "Goals",   title: "Goals" },
  { section: "review",  label: "Review",  title: "Review & Submit" },
] as const;

/** Step labels passed to WizardChrome (excludes the Welcome screen which has its own chrome). */
const CHROME_STEP_LABELS = STEPS.slice(1).map((s) => s.label) as string[];

// ─── Slice setters ──────────────────────────────────────────────────────────

function useDraftSliceSetters(value: IntakeDraft, onChange: (next: IntakeDraft) => void) {
  const setFamily: (patch: IntakeDraft["family"]) => void = (patch) =>
    onChange({ ...value, family: patch });
  const setAccounts: (patch: IntakeDraft["accounts"]) => void = (patch) =>
    onChange({ ...value, accounts: patch });
  const setIncome: (patch: IntakeDraft["income"]) => void = (patch) =>
    onChange({ ...value, income: patch });
  const setProperty: (patch: IntakeDraft["property"]) => void = (patch) =>
    onChange({ ...value, property: patch });
  const setGoals: (patch: IntakeDraft["goals"]) => void = (patch) =>
    onChange({ ...value, goals: patch });
  return { setFamily, setAccounts, setIncome, setProperty, setGoals };
}

// ─── Section → flat index map ────────────────────────────────────────────────
// Used by ReviewStep's onEdit to jump back to the right step.

const SECTION_TO_INDEX: Record<string, number> = {
  family: 1,
  accounts: 2,
  income: 3,
  property: 4,
  goals: 5,
};

// ─── Shell ───────────────────────────────────────────────────────────────────

export function IntakeWizard({
  value,
  onChange,
  onSubmit,
  mode,
  busy,
  error,
}: IntakeWizardProps) {
  // 0 = welcome; 1 = family; 2 = accounts; 3 = income; 4 = property; 5 = goals; 6 = review
  const [flatIndex, setFlatIndex] = useState(0);
  const { setFamily, setAccounts, setIncome, setProperty, setGoals } =
    useDraftSliceSetters(value, onChange);

  const step = STEPS[flatIndex];
  const isFirst = flatIndex === 0;
  const isLast = flatIndex === STEPS.length - 1;

  function goNext() {
    if (!isLast) setFlatIndex((i) => i + 1);
  }
  function goBack() {
    if (!isFirst) setFlatIndex((i) => i - 1);
  }
  function goToSection(section: "family" | "accounts" | "income" | "property" | "goals") {
    const idx = SECTION_TO_INDEX[section];
    if (idx !== undefined) setFlatIndex(idx);
  }

  // Welcome screen uses its own full-page chrome
  if (step.section === "welcome") {
    return (
      <div>
        {error && (
          <div
            role="alert"
            className="mx-auto max-w-2xl px-4 pt-4 text-sm text-crit"
          >
            {error}
          </div>
        )}
        <WelcomeScreen mode={mode} onStart={goNext} />
      </div>
    );
  }

  // All other steps use WizardChrome
  // flatIndex 1-6 → chrome step index 0-5
  const chromeIndex = flatIndex - 1;
  const isReview = step.section === "review";

  // On review: the chrome Next button IS the Submit (single affordance).
  const nextLabel = isReview ? "Submit" : step.skipable ? "Skip for now" : "Next";

  function renderBody() {
    switch (step.section) {
      case "family":
        return <FamilyStep value={value.family} onChange={setFamily} />;
      case "assets":
        if (step.subStep === "accounts") return <AccountsStep value={value.accounts} onChange={setAccounts} />;
        if (step.subStep === "income")   return <IncomeStep value={value.income} onChange={setIncome} />;
        if (step.subStep === "property") return <PropertyStep value={value.property} onChange={setProperty} />;
        return null;
      case "goals":
        return <GoalsStep value={value.goals} onChange={setGoals} />;
      case "review":
        return (
          <ReviewStep
            value={value}
            onEdit={goToSection}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mx-auto max-w-2xl px-4 pt-4 text-sm text-crit"
        >
          {error}
        </div>
      )}
      <WizardChrome
        stepLabels={CHROME_STEP_LABELS}
        current={chromeIndex}
        title={step.title}
        onBack={goBack}
        onNext={isReview ? () => void onSubmit() : goNext}
        nextLabel={nextLabel}
        backDisabled={false}
        nextDisabled={busy}
        busy={busy}
      >
        {renderBody()}
      </WizardChrome>
    </div>
  );
}
