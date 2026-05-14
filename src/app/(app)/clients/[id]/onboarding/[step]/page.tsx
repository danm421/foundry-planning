import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import { isStepSlug, type OnboardingState } from "@/lib/onboarding/types";
import { STEPS } from "@/lib/onboarding/steps";
import OnboardingShell from "../onboarding-shell";
import HouseholdStep from "../steps/household-step";
import FamilyStep from "../steps/family-step";
import AccountsStep from "../steps/accounts-step";
import LiabilitiesStep from "../steps/liabilities-step";
import CashFlowStep from "../steps/cash-flow-step";
import ReviewStep from "../steps/review-step";
import PlaceholderStep from "../steps/placeholder-step";

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
  const def = STEPS.find((s) => s.slug === step)!;

  let body: React.ReactNode;
  if (step === "household") {
    body = <HouseholdStep clientId={id} tree={effectiveTree} />;
  } else if (step === "family") {
    body = <FamilyStep clientId={id} tree={effectiveTree} />;
  } else if (step === "accounts") {
    body = <AccountsStep clientId={id} firmId={firmId} />;
  } else if (step === "liabilities") {
    body = <LiabilitiesStep clientId={id} firmId={firmId} />;
  } else if (step === "cash-flow") {
    body = <CashFlowStep clientId={id} firmId={firmId} />;
  } else if (step === "review") {
    body = (
      <ReviewStep clientId={id} statuses={statuses} alreadyFinished={row.completedAt !== null} />
    );
  } else if (def.placeholderInPhase1) {
    body = <PlaceholderStep clientId={id} slug={step} tabHref={def.tabHref?.(id) ?? `/clients/${id}`} />;
  } else {
    body = <PlaceholderStep clientId={id} slug={step} tabHref={`/clients/${id}`} />;
  }

  return (
    <OnboardingShell clientId={id} activeStep={step} statuses={statuses}>
      {body}
    </OnboardingShell>
  );
}
