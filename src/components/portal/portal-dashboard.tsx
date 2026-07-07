import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
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
  const [dto, [client]] = await Promise.all([
    loadPortalDashboard(clientId, new Date(), sharing),
    db
      .select({ portalEditEnabled: clients.portalEditEnabled })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1),
  ]);
  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink">Dashboard</h1>
      <DashboardGrid dto={dto} editEnabled={client?.portalEditEnabled ?? false} />
    </div>
  );
}
