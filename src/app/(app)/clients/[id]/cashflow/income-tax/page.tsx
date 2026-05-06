import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import IncomeTaxReport from "@/components/income-tax-report";

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
  await findClientInFirm(id, firmId);
  const scenarioId = sp.scenario ?? "base";
  return <IncomeTaxReport clientId={id} scenarioId={scenarioId} />;
}
