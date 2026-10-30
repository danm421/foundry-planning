import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { listHouseholdPickerOptions } from "@/lib/crm/households";
import { listUserConnectionSummaries } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { googleAppConfig, isGoogleConfigured } from "@/lib/workspace/google/config";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { buildItApprovalUrl } from "@/lib/workspace/microsoft/oauth";
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

  const googleEnabled = isGoogleConfigured();
  const itApprovalUrl = microsoftApprovalUrl();

  return (
    <WorkspacePage
      paneState={calendarPaneState({ impersonating, accountCount: accounts.length })}
      accounts={accounts}
      googleEnabled={googleEnabled}
      itApprovalUrl={itApprovalUrl}
      googleClientId={googleEnabled ? googleAppConfig().clientId : null}
      // The server's UTC date; the client's Today button uses the browser's.
      initialWeek={mondayOf(new Date().toISOString().slice(0, 10))}
      userId={userId}
      households={households}
    />
  );
}

/** The link for a Microsoft organization's admin; null where Microsoft isn't set up (the builder throws on a missing env var). */
function microsoftApprovalUrl(): string | null {
  try {
    return buildItApprovalUrl();
  } catch {
    return null;
  }
}
