import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import CashFlowReport from "@/components/cashflow-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface CashFlowPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function CashFlowPage({ params, searchParams }: CashFlowPageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  await findClientInFirm(clientId, firmId);
  return (
    <ScenarioDrawerShell clientId={clientId} scenarioId={sp.scenario}>
      <CashFlowReport clientId={clientId} />
    </ScenarioDrawerShell>
  );
}
