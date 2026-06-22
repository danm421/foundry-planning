import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import TransactionsSection from "@/components/portal/transactions-section";

export default async function TransactionsPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <TransactionsSection clientId={clientId} />;
}
