import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import IncomeTaxReport from "@/components/income-tax-report";
import ScenarioDrawerShell from "@/components/scenario/scenario-drawer-shell";

interface IncomeTaxPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function IncomeTaxPage({
  params,
  searchParams,
}: IncomeTaxPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  if (!(await findClientInFirm(id, firmId))) notFound();
  const scenarioId = sp.scenario ?? "base";
  return (
    <ScenarioDrawerShell clientId={id} scenarioId={sp.scenario}>
      <IncomeTaxReport clientId={id} scenarioId={scenarioId} />
    </ScenarioDrawerShell>
  );
}
