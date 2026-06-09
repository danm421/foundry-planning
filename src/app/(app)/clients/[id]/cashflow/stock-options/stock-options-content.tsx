import { db } from "@/db";
import { clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { buildVestingSchedule } from "@/engine/equity/vesting-schedule";
import { buildFutureActivity } from "@/engine/equity/future-activity";
import StockOptionsReportView from "@/components/stock-options-report-view";

interface Props {
  id: string;
  firmId: string;
  scenarioParam?: string;
}

export async function StockOptionsContent({ id, firmId, scenarioParam }: Props) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const { effectiveTree } = await loadEffectiveTree(id, firmId, scenarioParam ?? "base", {});
  const plans = effectiveTree.stockOptionPlans ?? [];
  const planStartYear = effectiveTree.planSettings.planStartYear;
  const planEndYear = effectiveTree.planSettings.planEndYear;

  // Both sub-reports are static (no runProjection). As-of anchors to plan start.
  const vestingModel = buildVestingSchedule(plans, { asOfYear: planStartYear, planStartYear });
  const futureActivityModel = buildFutureActivity(plans, {
    asOfYear: planStartYear,
    planStartYear,
    planEndYear,
  });

  return <StockOptionsReportView vestingModel={vestingModel} futureActivityModel={futureActivityModel} />;
}
