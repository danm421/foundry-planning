"use client";

import { useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { WizardChrome } from "@/components/wizard-chrome";
import { WelcomeScreen } from "./welcome-screen";
import { FamilyStep } from "./steps/family-step";

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
//
// Tasks 2.2-2.3 will swap the STUB bodies below for real child components.
// The shell selects the right body via `STEPS[flatIndex]` and passes its
// slice of `value` + a typed slice-setter down.

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
// Each one merges its section into the top-level draft and calls onChange.

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

// ─── Step body stubs ─────────────────────────────────────────────────────────
// These placeholders are replaced by Tasks 2.2 (family/accounts/income/property)
// and 2.3 (goals, review). The interface each Task 2.2/2.3 component must satisfy
// is documented in the comment above each stub.

/** STUB: Task 2.2 will replace this with <FamilyStep value={family} onChange={setFamily} /> */
function FamilyStepStub({ value }: { value: IntakeDraft["family"]; onChange: (v: IntakeDraft["family"]) => void }) {
  return (
    <div
      role="region"
      aria-label="Family"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Family step — Task 2.2 will replace this body.</p>
      {value && null}
    </div>
  );
}

/** STUB: Task 2.2 will replace with <AccountsStep value={accounts} onChange={setAccounts} /> */
function AccountsStepStub({ value }: { value: IntakeDraft["accounts"]; onChange: (v: IntakeDraft["accounts"]) => void }) {
  return (
    <div
      role="region"
      aria-label="Accounts"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Accounts step — Task 2.2 will replace this body.</p>
      {value && null}
    </div>
  );
}

/** STUB: Task 2.2 will replace with <IncomeStep value={income} onChange={setIncome} /> */
function IncomeStepStub({ value }: { value: IntakeDraft["income"]; onChange: (v: IntakeDraft["income"]) => void }) {
  return (
    <div
      role="region"
      aria-label="Income"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Income step — Task 2.2 will replace this body.</p>
      {value && null}
    </div>
  );
}

/** STUB: Task 2.2 will replace with <PropertyStep value={property} onChange={setProperty} /> */
function PropertyStepStub({ value }: { value: IntakeDraft["property"]; onChange: (v: IntakeDraft["property"]) => void }) {
  return (
    <div
      role="region"
      aria-label="Property"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Property step — Task 2.2 will replace this body.</p>
      {value && null}
    </div>
  );
}

/** STUB: Task 2.3 will replace with <GoalsStep value={goals} onChange={setGoals} /> */
function GoalsStepStub({ value }: { value: IntakeDraft["goals"]; onChange: (v: IntakeDraft["goals"]) => void }) {
  return (
    <div
      role="region"
      aria-label="Goals"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Goals step — Task 2.3 will replace this body.</p>
      {value && null}
    </div>
  );
}

/** STUB: Task 2.3 will replace with <ReviewStep value={value} busy={busy} onSubmit={onSubmit} />
 *  The Submit button is wired here in the shell so the affordance exists even on the scaffold. */
function ReviewStepStub({
  busy,
  onSubmit,
}: {
  value: IntakeDraft;
  busy?: boolean;
  onSubmit: () => Promise<void>;
}) {
  return (
    <div
      role="region"
      aria-label="Review"
      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-6 text-center text-ink-3"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Placeholder</p>
      <p className="mt-1 text-[13px]">Review accordion — Task 2.3 will replace this body.</p>
      <button
        type="button"
        onClick={() => void onSubmit()}
        disabled={busy}
        className="mt-4 rounded-[var(--radius-sm)] bg-accent px-6 py-2 text-sm font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

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
  const nextLabel = isReview ? "Submit" : step.skipable ? "Skip for now" : "Next";

  function renderBody() {
    switch (step.section) {
      case "family":
        return <FamilyStep value={value.family} onChange={setFamily} />;
      case "assets":
        if (step.subStep === "accounts") return <AccountsStepStub value={value.accounts} onChange={setAccounts} />;
        if (step.subStep === "income")   return <IncomeStepStub value={value.income} onChange={setIncome} />;
        if (step.subStep === "property") return <PropertyStepStub value={value.property} onChange={setProperty} />;
        return null;
      case "goals":
        return <GoalsStepStub value={value.goals} onChange={setGoals} />;
      case "review":
        return <ReviewStepStub value={value} busy={busy} onSubmit={onSubmit} />;
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
        onNext={isReview ? undefined : goNext}
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
