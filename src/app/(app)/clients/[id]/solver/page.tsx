import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { SolverContent } from "./solver-content";
import SolverSkeleton from "./loading-skeleton";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function SolverPage({ params, searchParams }: PageProps) {
  const { orgId: firmId, userId } = await requireOrgAndUser();
  const { id: clientId } = await params;
  const { scenario } = await searchParams;

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) notFound();

  const source = scenario && scenario !== "base" ? scenario : "base";

  return (
    <ScenarioDrawerShell clientId={clientId} scenarioId={scenario}>
      <Suspense fallback={<SolverSkeleton />}>
        <SolverContent clientId={clientId} firmId={firmId} userId={userId} source={source} />
      </Suspense>
    </ScenarioDrawerShell>
  );
}
