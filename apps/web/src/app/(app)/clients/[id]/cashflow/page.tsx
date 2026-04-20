import CashFlowReport from "@/components/cashflow-report";

interface CashFlowPageProps {
  params: Promise<{ id: string }>;
}

export default async function CashFlowPage({ params }: CashFlowPageProps) {
  const { id } = await params;
  return <CashFlowReport clientId={id} />;
}
