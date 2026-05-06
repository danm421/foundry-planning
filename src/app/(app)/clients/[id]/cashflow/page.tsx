import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import CashFlowReport from "@/components/cashflow-report";

interface CashFlowPageProps {
  params: Promise<{ id: string }>;
}

export default async function CashFlowPage({ params }: CashFlowPageProps) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();
  await findClientInFirm(clientId, firmId);
  return <CashFlowReport clientId={clientId} />;
}
