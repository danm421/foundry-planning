// src/app/(app)/clients/[id]/cashflow/asset-ledger/page.tsx
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import AssetLedgerReport from "@/components/asset-ledger-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface AssetLedgerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function AssetLedgerPage({ params, searchParams }: AssetLedgerPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  if (!(await findClientInFirm(id, firmId))) notFound();
  const scenarioId = sp.scenario ?? "base";
  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <AssetLedgerReport clientId={id} scenarioId={scenarioId} />
    </ScenarioDrawerShell>
  );
}
