import { Suspense } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { isStepSlug, type OnboardingState } from "@/lib/onboarding/types";
import { OnboardingStepContent } from "./onboarding-step-content";
import OnboardingStepSkeleton from "./loading-skeleton";

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

  const state = (row.state as OnboardingState | null) ?? {};

  return (
    <Suspense fallback={<OnboardingStepSkeleton />}>
      <OnboardingStepContent
        clientId={id}
        firmId={firmId}
        step={step}
        completedAt={row.completedAt}
        state={state}
      />
    </Suspense>
  );
}
