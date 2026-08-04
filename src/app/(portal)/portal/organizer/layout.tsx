import type { ReactElement, ReactNode } from "react";
import OrganizerTabs from "@/components/portal/organizer-tabs";

/**
 * Chrome for the Organizer section: the tab strip that navigates between
 * Household, Accounts, Goals and Cash Flow. Nothing here reads the DB — each
 * tab's page still does its own `requireClientPortalAccess()`.
 */
export default function OrganizerLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <OrganizerTabs />
      {children}
    </>
  );
}
