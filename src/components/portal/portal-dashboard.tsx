import type { ReactElement } from "react";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
import { DashboardGrid } from "@/components/portal/dashboard-grid";

interface Props {
  clientId: string;
}

export default async function PortalDashboard({ clientId }: Props): Promise<ReactElement> {
  const dto = await loadPortalDashboard(clientId, new Date());
  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink">Dashboard</h1>
      <DashboardGrid dto={dto} />
    </div>
  );
}
