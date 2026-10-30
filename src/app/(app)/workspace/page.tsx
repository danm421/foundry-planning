import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { listHouseholdPickerOptions } from "@/lib/crm/households";
import { listUserConnectionSummaries } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isGoogleConfigured } from "@/lib/workspace/google/config";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { calendarPaneState } from "@/lib/workspace/pane-state";
import { mondayOf } from "@/lib/workspace/week";
import Forbidden from "../settings/forbidden";
import { WorkspacePage } from "./_components/workspace-page";

/**
 * The advisor's Workspace: every connected address's week beside their
 * to-dos. The calendar pane's state is read from Foundry's own records with no
 * call to a provider — the week and the to-dos themselves are fetched by the
 * client. An ops impersonation session reads none of the advisor's addresses.
 */
export default async function WorkspaceRoute(): Promise<ReactElement> {
  if (!isWorkspaceEnabled()) notFound();
  const { orgId: firmId, userId, orgRole } = await auth();
  if (!firmId || !userId) return <Forbidden requiredRole="firm member" />;

  const impersonating = await isImpersonating();
  const [accounts, households] = await Promise.all([
    // The summaries only: no token is decrypted to draw this page.
    impersonating ? [] : listUserConnectionSummaries(firmId, userId),
    // For the to-do panel's household picker on a new Foundry task.
    listHouseholdPickerOptions(firmId, userId, orgRole),
  ]);

  return (
    <WorkspacePage
      paneState={calendarPaneState({ impersonating, accountCount: accounts.length })}
      accounts={accounts}
      googleEnabled={isGoogleConfigured()}
      // The server's UTC date; the client's Today button uses the browser's.
      initialWeek={mondayOf(new Date().toISOString().slice(0, 10))}
      userId={userId}
      households={households}
    />
  );
}
