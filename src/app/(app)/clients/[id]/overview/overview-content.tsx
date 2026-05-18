import { Suspense } from "react";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import KpiStrip from "@/components/client-overview/kpi-strip";
import PortfolioGrowthPanel from "@/components/client-overview/portfolio-growth-panel";
import AllocationPanel from "@/components/client-overview/allocation-panel";
import OpenItemsPreview from "@/components/client-overview/open-items-preview";
import RecentActivityPanel from "@/components/client-overview/recent-activity-panel";
import EmptyHouseholdBanner from "@/components/client-overview/empty-household-banner";
import { isFreshHousehold } from "@/components/client-overview/is-fresh-household";
import { AlertsStripSlot } from "@/components/client-overview/alerts-strip-slot";
import { AlertsStripSkeleton } from "@/components/client-overview/alerts-strip-skeleton";

export async function OverviewContent({
  clientId,
  firmId,
  scenarioId,
}: {
  clientId: string;
  firmId: string;
  scenarioId: string;
}) {
  const d = await getOverviewData(clientId, firmId, scenarioId);

  return (
    <div className="flex flex-col gap-[var(--gap-grid)]">
      {isFreshHousehold(d.accountCount) && <EmptyHouseholdBanner clientId={clientId} />}

      <KpiStrip
        clientId={clientId}
        netWorth={d.kpi.netWorth}
        liquidPortfolio={d.kpi.liquidPortfolio}
      />

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <PortfolioGrowthPanel clientId={clientId} projection={d.projection} />
        <AllocationPanel clientId={clientId} rollup={d.allocation} />
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <OpenItemsPreview
          clientId={clientId}
          items={d.openItemsPreview}
          totalOpen={d.totalOpen}
          totalCompleted={d.totalCompleted}
        />
        <Suspense fallback={<AlertsStripSkeleton />}>
          <AlertsStripSlot
            clientId={clientId}
            firmId={firmId}
            scenarioId={scenarioId}
            alertInputs={d.alertInputs}
            clientMeta={{ id: d.client.id, updatedAt: d.client.updatedAt }}
          />
        </Suspense>
      </div>

      <RecentActivityPanel clientId={clientId} rows={d.auditRows} />
    </div>
  );
}
