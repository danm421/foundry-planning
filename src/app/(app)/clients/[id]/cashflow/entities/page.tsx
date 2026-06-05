import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { EntitiesCashFlowContent } from "./entities-cashflow-content";
import EntitiesCashFlowSkeleton from "./loading-skeleton";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function EntitiesCashFlowReportPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const inFirm = await findClientInFirm(id, firmId);
  if (!inFirm) notFound();

  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <Suspense fallback={<EntitiesCashFlowSkeleton />}>
        <EntitiesCashFlowContent id={id} firmId={firmId} scenarioParam={sp.scenario} />
      </Suspense>
    </ScenarioDrawerShell>
  );
}
