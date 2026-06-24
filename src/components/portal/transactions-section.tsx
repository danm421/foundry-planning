import type { ReactElement } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import TransactionsList from "@/components/portal/transactions-list";
import CategoriesManager from "@/components/portal/categories-manager";

// editEnabled derives from the client's portalEditEnabled flag — the same gate
// every other portal section uses — so advisor "preview as client" can edit
// (the /api/portal/* routes are act-as aware) exactly when client editing is on.
export default async function TransactionsSection({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const editEnabled = client?.portalEditEnabled ?? false;

  return (
    <div className="max-w-3xl space-y-5 p-5">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-ink">Transactions</h1>
        <p className="text-[13px] text-ink-3">
          Spending and income from your linked accounts, categorized automatically.
        </p>
      </header>
      <TransactionsList clientId={clientId} editEnabled={editEnabled} />
      <details className="rounded-xl border border-hair bg-card-2 p-4">
        <summary className="cursor-pointer text-[13px] text-ink-2">Manage categories</summary>
        <div className="mt-3"><CategoriesManager editEnabled={editEnabled} /></div>
      </details>
    </div>
  );
}
