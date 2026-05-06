import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import MonteCarloReport from "@/components/monte-carlo-report";

interface MonteCarloPageProps {
  params: Promise<{ id: string }>;
}

export default async function MonteCarloPage({ params }: MonteCarloPageProps) {
  const { id } = await params;
  const firmId = await requireOrgId();
  await findClientInFirm(id, firmId);
  return <MonteCarloReport clientId={id} />;
}
