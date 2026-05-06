import KpiCard from "./kpi-card";
import { getMonteCarloResult } from "@/lib/projection/get-monte-carlo-result";

export async function MonteCarloKpiSlot({
  clientId,
  firmId,
  scenarioId = "base",
}: {
  clientId: string;
  firmId: string;
  scenarioId?: string | "base";
}) {
  const result = await getMonteCarloResult(clientId, firmId, scenarioId);
  return (
    <KpiCard
      href={`/clients/${clientId}/cashflow/monte-carlo`}
      num="03"
      categoryLabel="Resilience"
      category="life"
      label="Monte Carlo success"
      value={result?.successRate ?? null}
      valueFormat="pct"
      footnote="10,000 trials"
      delta={null}
    />
  );
}
