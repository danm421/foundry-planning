// src/components/portal/budget-section.tsx
import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { loadBudgetSummary } from "@/lib/portal/load-budget-data";
import BudgetView from "@/components/portal/budget-view";

export default async function BudgetSection({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const summary = await loadBudgetSummary(clientId, new Date());
  return <BudgetView summary={summary} editEnabled={client?.portalEditEnabled ?? false} />;
}
