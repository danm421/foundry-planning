import type { ReactElement, ReactNode } from "react";
import BudgetTabs from "@/components/portal/budget-tabs";

/**
 * Chrome for the Budget section: the tab strip that navigates between Budget,
 * Transactions and Recurring. Nothing here reads the DB — each tab's page
 * still does its own `requireClientPortalAccess()`.
 */
export default function BudgetLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <BudgetTabs />
      {children}
    </>
  );
}
