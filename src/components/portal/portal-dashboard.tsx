import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalFeatureColumns } from "@/lib/portal/load-features";
import type { PortalPrivacy } from "@/lib/portal/privacy";
import { DashboardGrid } from "@/components/portal/dashboard-grid";

interface Props {
  clientId: string;
  /** Advisor preview passes the client's sharing switches; the client's own portal omits it (everything shared with themselves). */
  sharing?: PortalPrivacy;
}

export default async function PortalDashboard({ clientId, sharing }: Props): Promise<ReactElement> {
  // editEnabled mirrors TransactionsSection: the client's portalEditEnabled
  // flag gates the drill-down panel's categorize / mark-reviewed actions.
  //
  // This read lands BEFORE the dashboard load rather than beside it: the
  // advisor's Budget switch decides which queries that loader may run at all,
  // so it cannot be applied afterwards.
  const [client] = await db
    .select({
      portalEditEnabled: clients.portalEditEnabled,
      ...portalFeatureColumns,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const dto = await loadPortalDashboard(clientId, new Date(), sharing, {
    budgetEnabled: toPortalFeatures(client).budget,
  });

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink">Dashboard</h1>
      <DashboardGrid dto={dto} editEnabled={client?.portalEditEnabled ?? false} />
    </div>
  );
}
