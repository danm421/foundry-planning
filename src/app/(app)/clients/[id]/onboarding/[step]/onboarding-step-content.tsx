import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import { isImportEligibleStep } from "@/lib/onboarding/import-sections";
import type { OnboardingState, StepSlug } from "@/lib/onboarding/types";
import OnboardingShell from "../onboarding-shell";
import WizardImportLauncher from "@/components/onboarding/wizard-import-launcher";
import HouseholdStep from "../steps/household-step";
import FamilyStep from "../steps/family-step";
import EntitiesStep from "../steps/entities-step";
import AccountsStep from "../steps/accounts-step";
import LiabilitiesStep from "../steps/liabilities-step";
import CashFlowStep from "../steps/cash-flow-step";
import InsuranceStep from "../steps/insurance-step";
import EstateStep from "../steps/estate-step";
import AssumptionsStep from "../steps/assumptions-step";
import ReviewStep from "../steps/review-step";

interface Props {
  clientId: string;
  firmId: string;
  step: StepSlug;
  completedAt: Date | null;
  state: OnboardingState;
}

export async function OnboardingStepContent({ clientId, firmId, step, completedAt, state }: Props) {
  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
  const statuses = deriveStepStatuses(effectiveTree, state);

  const importEligible = isImportEligibleStep(step);
  let baseScenarioId: string | null = null;
  if (importEligible) {
    const [base] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    baseScenarioId = base?.id ?? null;
  }
  const activeImportId = state.activeImportId ?? null;

  let body: React.ReactNode;
  if (step === "household") {
    body = <HouseholdStep clientId={clientId} tree={effectiveTree} />;
  } else if (step === "family") {
    body = <FamilyStep clientId={clientId} tree={effectiveTree} />;
  } else if (step === "entities") {
    body = <EntitiesStep clientId={clientId} tree={effectiveTree} />;
  } else if (step === "accounts") {
    body = <AccountsStep clientId={clientId} firmId={firmId} />;
  } else if (step === "liabilities") {
    body = <LiabilitiesStep clientId={clientId} firmId={firmId} />;
  } else if (step === "cash-flow") {
    body = <CashFlowStep clientId={clientId} firmId={firmId} />;
  } else if (step === "insurance") {
    body = <InsuranceStep clientId={clientId} firmId={firmId} />;
  } else if (step === "estate") {
    body = <EstateStep clientId={clientId} firmId={firmId} />;
  } else if (step === "assumptions") {
    body = <AssumptionsStep clientId={clientId} firmId={firmId} />;
  } else if (step === "review") {
    body = (
      <ReviewStep clientId={clientId} statuses={statuses} alreadyFinished={completedAt !== null} />
    );
  } else {
    body = (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
        Unknown step.
      </div>
    );
  }

  return (
    <OnboardingShell clientId={clientId} activeStep={step} statuses={statuses}>
      {isImportEligibleStep(step) && baseScenarioId ? (
        <WizardImportLauncher
          clientId={clientId}
          step={step}
          baseScenarioId={baseScenarioId}
          activeImportId={activeImportId}
        />
      ) : null}
      {body}
    </OnboardingShell>
  );
}
