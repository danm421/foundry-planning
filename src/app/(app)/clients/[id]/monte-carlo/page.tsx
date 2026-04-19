import MonteCarloReport from "@/components/monte-carlo-report";

interface MonteCarloPageProps {
  params: Promise<{ id: string }>;
}

export default async function MonteCarloPage({ params }: MonteCarloPageProps) {
  const { id } = await params;
  return <MonteCarloReport clientId={id} />;
}
