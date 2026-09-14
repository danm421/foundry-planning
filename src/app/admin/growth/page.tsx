import { notFound } from "next/navigation";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { loadGrowthInput } from "@/lib/ops/growth/load";
import { buildMetrics } from "@/lib/ops/growth/metrics";
import { buildFunnel } from "@/lib/ops/growth/funnel";
import { buildAttention } from "@/lib/ops/growth/attention";
import { buildFirmRows } from "@/lib/ops/growth/firm-rows";
import GrowthClient from "./growth-client";

// Never cached: this page shows live revenue and every customer's email.
export const dynamic = "force-dynamic";

export default async function GrowthPage() {
  // One rank above the `support` default the other admin pages use — this
  // screen puts revenue and every customer email in one place.
  try {
    await requireOpsAdmin("ops");
  } catch {
    notFound();
  }

  // Every builder is pure and takes the same snapshot, so a number here and
  // the same number in the digest cannot drift.
  //
  // One deliberate gap: the digest ALSO renders buildAccountRows — every live
  // trial, not just the ones inside TRIAL_ENDING_DAYS — while "Needs you"
  // below still shows the attention rows only. Folding that roster onto this
  // page is open work, not an oversight.
  const input = await loadGrowthInput();

  return (
    <GrowthClient
      metrics={buildMetrics(input)}
      funnel={buildFunnel(input)}
      attention={buildAttention(input)}
      firms={buildFirmRows(input)}
    />
  );
}
