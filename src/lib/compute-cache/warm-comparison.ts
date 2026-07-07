// Pre-warm the compute cache for a Retirement Comparison deck: ensures the
// Monte Carlo + max-spend results for BOTH the base plan and the compared
// scenario are computed and cached, so the eventual "Generate PDF" run reuses
// them instead of computing ~4 simulations + 2 solves inline (the 800s-timeout
// path). Best-effort: each compute is independent and its failure is logged,
// never thrown — a failed warm just means the run recomputes as it does today.
import { getOrComputeMonteCarlo } from "./monte-carlo";
import { getOrComputeMaxSpending } from "./max-spending";

export async function warmComparisonCompute(args: {
  clientId: string;
  firmId: string;
  /** The compared scenario id (never "base"). */
  scenarioId: string;
  targetPoS: number;
}): Promise<void> {
  const { clientId, firmId, scenarioId, targetPoS } = args;
  const refs: string[] = ["base", scenarioId];
  const swallow = (label: string) => (err: unknown) => {
    console.error(`[warm-comparison] ${label} failed (non-fatal):`, err);
  };
  await Promise.all(
    refs.flatMap((ref) => [
      getOrComputeMonteCarlo({ clientId, firmId, scenarioId: ref }).catch(swallow(`mc:${ref}`)),
      getOrComputeMaxSpending({ clientId, firmId, scenarioId: ref, targetPoS }).catch(swallow(`maxspend:${ref}`)),
    ]),
  );
}
