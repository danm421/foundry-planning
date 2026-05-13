import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
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

export const dynamic = "force-dynamic";

export default async function ClientOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string; toggles?: string }>;
}) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;
  const scenarioId = sp.scenario ?? "base";
  if (!(await findClientInFirm(id, firmId))) notFound();

  const d = await getOverviewData(id, firmId, scenarioId);

  return (
    <div className="flex flex-col gap-[var(--gap-grid)]">
      {isFreshHousehold(d.accountCount) && <EmptyHouseholdBanner clientId={id} />}

      <KpiStrip
        clientId={id}
        netWorth={d.kpi.netWorth}
        liquidPortfolio={d.kpi.liquidPortfolio}
      />

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <PortfolioGrowthPanel clientId={id} projection={d.projection} />
        <AllocationPanel clientId={id} rollup={d.allocation} />
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <OpenItemsPreview
          clientId={id}
          items={d.openItemsPreview}
          totalOpen={d.totalOpen}
          totalCompleted={d.totalCompleted}
        />
        <Suspense fallback={<AlertsStripSkeleton />}>
          <AlertsStripSlot
            clientId={id}
            firmId={firmId}
            scenarioId={scenarioId}
            alertInputs={d.alertInputs}
            clientMeta={{ id: d.client.id, updatedAt: d.client.updatedAt }}
          />
        </Suspense>
      </div>

      <RecentActivityPanel clientId={id} rows={d.auditRows} />
    </div>
  );
}
