import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import { isStepSlug, type OnboardingState } from "@/lib/onboarding/types";
import { isImportEligibleStep } from "@/lib/onboarding/import-sections";
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

interface PageProps {
  params: Promise<{ id: string; step: string }>;
}

export default async function OnboardingStepPage({ params }: PageProps) {
  const { id, step } = await params;
  if (!isStepSlug(step)) notFound();

  const firmId = await requireOrgId();
  const [row] = await db
    .select({ id: clients.id, state: clients.onboardingState, completedAt: clients.onboardingCompletedAt })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!row) notFound();

  const { effectiveTree } = await loadEffectiveTree(id, firmId, "base", {});
  const state = (row.state as OnboardingState | null) ?? {};
  const statuses = deriveStepStatuses(effectiveTree, state);

  const importEligible = isImportEligibleStep(step);
  let baseScenarioId: string | null = null;
  if (importEligible) {
    const [base] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    baseScenarioId = base?.id ?? null;
  }
  const activeImportId = state.activeImportId ?? null;

  let body: React.ReactNode;
  if (step === "household") {
    body = <HouseholdStep clientId={id} tree={effectiveTree} />;
  } else if (step === "family") {
    body = <FamilyStep clientId={id} tree={effectiveTree} />;
  } else if (step === "entities") {
    body = <EntitiesStep clientId={id} tree={effectiveTree} />;
  } else if (step === "accounts") {
    body = <AccountsStep clientId={id} firmId={firmId} />;
  } else if (step === "liabilities") {
    body = <LiabilitiesStep clientId={id} firmId={firmId} />;
  } else if (step === "cash-flow") {
    body = <CashFlowStep clientId={id} firmId={firmId} />;
  } else if (step === "insurance") {
    body = <InsuranceStep clientId={id} firmId={firmId} />;
  } else if (step === "estate") {
    body = <EstateStep clientId={id} firmId={firmId} />;
  } else if (step === "assumptions") {
    body = <AssumptionsStep clientId={id} firmId={firmId} />;
  } else if (step === "review") {
    body = (
      <ReviewStep clientId={id} statuses={statuses} alreadyFinished={row.completedAt !== null} />
    );
  } else {
    body = (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
        Unknown step.
      </div>
    );
  }

  return (
    <OnboardingShell clientId={id} activeStep={step} statuses={statuses}>
      {isImportEligibleStep(step) && baseScenarioId ? (
        <WizardImportLauncher
          clientId={id}
          step={step}
          baseScenarioId={baseScenarioId}
          activeImportId={activeImportId}
        />
      ) : null}
      {body}
    </OnboardingShell>
  );
}
