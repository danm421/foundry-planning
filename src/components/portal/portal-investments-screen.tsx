// src/components/portal/portal-investments-screen.tsx
import type { ReactElement } from "react";
import { loadPortalInvestments } from "@/lib/portal/load-portal-investments";
import { PortalInvestmentsClient } from "@/components/portal/portal-investments-client";

export async function PortalInvestmentsScreen({ clientId }: { clientId: string }): Promise<ReactElement> {
  const data = await loadPortalInvestments(clientId);
  const asOfDate = new Date().toISOString().slice(0, 10);
  return <PortalInvestmentsClient data={data} asOfDate={asOfDate} />;
}
