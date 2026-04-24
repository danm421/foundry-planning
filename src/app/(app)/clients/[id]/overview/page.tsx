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

  return (
    <div className="space-y-6">
      <KpiStrip clientId={id} {...d.kpi} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RunwayPanel clientId={id} {...d.runway} />
        <AllocationPanel clientId={id} rollup={d.allocation} />
      </div>
      <LifeEventsPanel clientId={id} events={d.lifeEvents} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
