import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { hasMemberAccess } from "@/lib/workspace/access";
import { getFirmApproval } from "@/lib/workspace/approvals";
import { listFirmConnectionSummaries } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { calendarPaneState } from "@/lib/workspace/member-status";
import { mondayOf } from "@/lib/workspace/week";
import Forbidden from "../settings/forbidden";
import { WorkspacePage } from "./_components/workspace-page";

/**
 * The advisor's Workspace: their Outlook week beside their to-dos. The
 * calendar pane's state is read from Foundry's own records, the same checks
 * `resolveActingConnection` makes, with no call to Microsoft — the week itself
 * is fetched by the client.
 */
export default async function WorkspaceRoute(): Promise<ReactElement> {
  if (!isWorkspaceEnabled()) notFound();
  const { orgId: firmId, userId, orgRole } = await auth();
  if (!firmId || !userId) return <Forbidden requiredRole="firm member" />;

  const approved = (await getFirmApproval(firmId, "microsoft")) !== null;
  const enabled = approved && (await hasMemberAccess(firmId, userId, "microsoft"));
  // The status only: no token is decrypted to draw this page.
  const connection = enabled
    ? ((await listFirmConnectionSummaries(firmId, "microsoft")).find((c) => c.userId === userId) ?? null)
    : null;

  return (
    <WorkspacePage
      paneState={calendarPaneState({ approved, enabled, connection })}
      isAdmin={orgRole === "org:admin"}
      // The server's UTC date; the client's Today button uses the browser's.
      initialWeek={mondayOf(new Date().toISOString().slice(0, 10))}
    />
  );
}
