import { db } from "@/db";
import { clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine/projection";
import { buildVestingSchedule } from "@/engine/equity/vesting-schedule";
import { buildFutureActivity } from "@/engine/equity/future-activity";
import { buildEquityTaxImpact } from "@/engine/equity/tax-impact";
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

  // Vesting is static (no projection). As-of anchors to plan start.
  const vestingModel = buildVestingSchedule(plans, { asOfYear: planStartYear, planStartYear });

  // Tax Impact needs the full projection (counterfactual against the client's
  // other income). Runs server-side here — this is a server component. Skip the
  // projection entirely when the client has no option plans (same opt-in the
  // equity phase uses): buildEquityTaxImpact([]) reports no activity.
  const years = plans.length > 0 ? runProjection(effectiveTree) : [];
  const taxImpactModel = buildEquityTaxImpact(years);

  // Join the per-year additional tax into Future Activity's year subtotals + grand
  // total (Tax Impact and Future Activity share the same projection horizon, so the
  // year keys align). Per-grant rows stay "—" — the counterfactual is joint by year.
  const taxByYear = new Map(taxImpactModel.rows.map((r) => [r.year, r.totalTax]));
  const futureActivityModel = buildFutureActivity(plans, {
    asOfYear: planStartYear,
    planStartYear,
    planEndYear,
    taxByYear,
  });

  return (
    <StockOptionsReportView
      vestingModel={vestingModel}
      futureActivityModel={futureActivityModel}
      taxImpactModel={taxImpactModel}
    />
  );
}
