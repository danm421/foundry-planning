import type { ReactElement } from "react";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
import type { PortalPrivacy } from "@/lib/portal/privacy";
import { DashboardGrid } from "@/components/portal/dashboard-grid";

interface Props {
  clientId: string;
  /** Advisor preview passes the client's sharing switches; the client's own portal omits it (everything shared with themselves). */
  sharing?: PortalPrivacy;
}

export default async function PortalDashboard({ clientId, sharing }: Props): Promise<ReactElement> {
  const dto = await loadPortalDashboard(clientId, new Date(), sharing);
  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink">Dashboard</h1>
      <DashboardGrid dto={dto} />
    </div>
  );
}
