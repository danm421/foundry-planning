import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import KpiStrip from "@/components/client-overview/kpi-strip";
import RunwayPanel from "@/components/client-overview/runway-panel";
import AllocationPanel from "@/components/client-overview/allocation-panel";
import LifeEventsPanel from "@/components/client-overview/life-events-panel";
import OpenItemsPreview from "@/components/client-overview/open-items-preview";
import AlertsStrip from "@/components/client-overview/alerts-strip";
import RecentActivityPanel from "@/components/client-overview/recent-activity-panel";
import EmptyHouseholdBanner from "@/components/client-overview/empty-household-banner";
import { isFreshHousehold } from "@/components/client-overview/is-fresh-household";

export const dynamic = "force-dynamic";

export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const firmId = await getOrgId();
  const { id } = await params;
  if (!(await findClientInFirm(id, firmId))) notFound();

  const d = await getOverviewData(id, firmId);

  const earliestRetirementYear = d.lifeEvents.length
    ? Math.min(...d.lifeEvents.map((e) => e.year))
    : null;

  return (
    <div className="flex flex-col gap-[var(--gap-grid)]">
      {isFreshHousehold(d.accountCount) && <EmptyHouseholdBanner clientId={id} />}

      <KpiStrip
        clientId={id}
        netWorth={d.kpi.netWorth}
        liquidPortfolio={d.kpi.liquidPortfolio}
        monteCarloSuccess={d.kpi.monteCarloSuccess}
        yearsToRetirement={d.kpi.yearsToRetirement}
        earliestRetirementYear={earliestRetirementYear}
      />

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <RunwayPanel
          clientId={id}
          monteCarloSuccess={d.runway.monteCarloSuccess}
          netWorthSeries={d.runway.netWorthSeries}
        />
        <AllocationPanel clientId={id} rollup={d.allocation} />
      </div>

      <LifeEventsPanel clientId={id} events={d.lifeEvents} />

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <OpenItemsPreview
          clientId={id}
          items={d.openItemsPreview}
          totalOpen={d.totalOpen}
          totalCompleted={d.totalCompleted}
        />
        <AlertsStrip alerts={d.alerts} />
      </div>

      <RecentActivityPanel rows={d.auditRows} />
    </div>
  );
}
