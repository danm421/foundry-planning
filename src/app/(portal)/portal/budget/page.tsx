import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import BudgetSection from "@/components/portal/budget-section";

export default async function BudgetPage(): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  return <BudgetSection clientId={clientId} />;
}
