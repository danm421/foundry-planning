// src/app/(app)/clients/[id]/cashflow/tax-ledger/page.tsx
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import TaxLedgerReport from "@/components/tax-ledger-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface TaxLedgerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function TaxLedgerPage({ params, searchParams }: TaxLedgerPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  await findClientInFirm(id, firmId);
  const scenarioId = sp.scenario ?? "base";
  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <TaxLedgerReport clientId={id} scenarioId={scenarioId} />
    </ScenarioDrawerShell>
  );
}
