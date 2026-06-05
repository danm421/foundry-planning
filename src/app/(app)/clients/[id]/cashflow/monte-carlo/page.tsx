import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import MonteCarloReport from "@/components/monte-carlo-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface MonteCarloPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function MonteCarloPage({
  params,
  searchParams,
}: MonteCarloPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  await findClientInFirm(id, firmId);
  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <MonteCarloReport clientId={id} />
    </ScenarioDrawerShell>
  );
}
