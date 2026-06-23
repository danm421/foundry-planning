import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, transactionCategories } from "@/db/schema";
import { loadRecurringsData } from "@/lib/portal/load-recurrings-data";
import RecurringsView from "@/components/portal/recurrings-view";

export default async function RecurringsSection({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const data = await loadRecurringsData(clientId, new Date());
  const categories = await db
    .select({
      id: transactionCategories.id,
      name: transactionCategories.name,
      kind: transactionCategories.kind,
      parentId: transactionCategories.parentId,
    })
    .from(transactionCategories)
    .where(eq(transactionCategories.clientId, clientId));
  return (
    <RecurringsView
      data={data}
      categories={categories}
      editEnabled={client?.portalEditEnabled ?? false}
    />
  );
}
