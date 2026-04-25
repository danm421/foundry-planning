import AlertsStrip from "./alerts-strip";
import { getMonteCarloResult } from "@/lib/projection/get-monte-carlo-result";
import { computeAlerts, type Alert } from "@/lib/alerts";
import type { OverviewAlertInputs } from "@/lib/overview/get-overview-data";

export async function AlertsStripSlot({
  clientId,
  firmId,
  alertInputs,
  clientMeta,
}: {
  clientId: string;
  firmId: string;
  alertInputs: OverviewAlertInputs;
  clientMeta: { id: string; updatedAt: Date | string };
}) {
  const mc = await getMonteCarloResult(clientId, firmId);

  const alerts: Alert[] = computeAlerts(clientMeta, {
    monteCarloSuccess: mc?.successRate ?? null,
    liquidPortfolio: alertInputs.liquidPortfolio,
    currentYearNetOutflow: alertInputs.currentYearNetOutflow,
    minNetWorth: alertInputs.minNetWorth,
  });

  if (alertInputs.projectionError) {
    alerts.push({
      id: "projection-error",
      severity: "warning",
      title: "Projection couldn't be computed",
      detail: alertInputs.projectionError,
    });
  }

  return <AlertsStrip alerts={alerts} />;
}
