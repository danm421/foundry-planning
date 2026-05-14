import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { getOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import type { OnboardingState } from "@/lib/onboarding/types";
import { STEPS } from "@/lib/onboarding/steps";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OnboardingResumePage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [row] = await db
    .select({ id: clients.id, state: clients.onboardingState })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!row) notFound();

  const state = (row.state as OnboardingState | null) ?? {};

  if (state.lastStepVisited) {
    redirect(`/clients/${id}/onboarding/${state.lastStepVisited}`);
  }

  const { effectiveTree } = await loadEffectiveTree(id, firmId, "base", {});
  const statuses = deriveStepStatuses(effectiveTree, state);
  const firstIncomplete = STEPS.find((s) => {
    const st = statuses.find((x) => x.slug === s.slug);
    return st && st.kind !== "complete" && st.kind !== "skipped";
  });
  redirect(`/clients/${id}/onboarding/${firstIncomplete?.slug ?? "review"}`);
}
