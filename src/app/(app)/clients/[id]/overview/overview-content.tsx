import { getOverviewData } from "@/lib/overview/get-overview-data";
import { computeAlerts } from "@/lib/alerts";
import KpiStrip from "@/components/client-overview/kpi-strip";
import PortfolioGrowthPanel from "@/components/client-overview/portfolio-growth-panel";
import AllocationPanel from "@/components/client-overview/allocation-panel";
import OpenItemsPreview from "@/components/client-overview/open-items-preview";
import RecentActivityPanel from "@/components/client-overview/recent-activity-panel";
import EmptyHouseholdBanner from "@/components/client-overview/empty-household-banner";
import { isFreshHousehold } from "@/components/client-overview/is-fresh-household";
import AlertsStrip from "@/components/client-overview/alerts-strip";
import WelcomeHeader from "@/components/client-overview/welcome-header";

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

  // Alerts are computed synchronously from already-loaded overview data. Monte
  // Carlo is intentionally excluded here: the MC success-rate alert required a
  // 1000-trial simulation (~15s) on every overview load, which froze the page.
  // The remaining rules (liquidity runway, negative net worth, stale data) run
  // off data we already have. The projection-error alert is appended below.
  const alerts = computeAlerts(
    { id: d.client.id, updatedAt: d.client.updatedAt },
    {
      monteCarloSuccess: null,
      liquidPortfolio: d.alertInputs.liquidPortfolio,
      currentYearNetOutflow: d.alertInputs.currentYearNetOutflow,
      minNetWorth: d.alertInputs.minNetWorth,
    },
  );
  if (d.alertInputs.projectionError) {
    alerts.push({
      id: "projection-error",
      severity: "warning",
      title: "Projection couldn't be computed",
      detail: d.alertInputs.projectionError,
    });
  }

  return (
    <div className="flex flex-col gap-[var(--gap-grid)]">
      <WelcomeHeader name={d.householdName} updatedAt={d.client.updatedAt} />

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
        <AlertsStrip alerts={alerts} />
      </div>

      <RecentActivityPanel clientId={clientId} rows={d.auditRows} />
    </div>
  );
}
