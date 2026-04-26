import RunwayGauge from "./runway-gauge";
import { getMonteCarloResult } from "@/lib/projection/get-monte-carlo-result";

export async function RunwayGaugeSlot({
  clientId,
  firmId,
  scenarioId = "base",
}: {
  clientId: string;
  firmId: string;
  scenarioId?: string | "base";
}) {
  const result = await getMonteCarloResult(clientId, firmId, scenarioId);
  return <RunwayGauge value={result?.successRate ?? null} />;
}
