import RunwayGauge from "./runway-gauge";
import { getMonteCarloResult } from "@/lib/projection/get-monte-carlo-result";

export async function RunwayGaugeSlot({
  clientId,
  firmId,
}: {
  clientId: string;
  firmId: string;
}) {
  const result = await getMonteCarloResult(clientId, firmId);
  return <RunwayGauge value={result?.successRate ?? null} />;
}
