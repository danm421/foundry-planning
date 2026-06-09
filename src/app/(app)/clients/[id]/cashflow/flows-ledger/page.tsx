// src/app/(app)/clients/[id]/cashflow/flows-ledger/page.tsx
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import FlowsLedgerReport from "@/components/flows-ledger-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface FlowsLedgerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function FlowsLedgerPage({ params, searchParams }: FlowsLedgerPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  if (!(await findClientInFirm(id, firmId))) notFound();
  const scenarioId = sp.scenario ?? "base";
  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <FlowsLedgerReport clientId={id} scenarioId={scenarioId} />
    </ScenarioDrawerShell>
  );
}
