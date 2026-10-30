import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** Cancels an event the advisor organizes (attendees are notified when there are any). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ connectionId: string; eventId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { connectionId, eventId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, connectionId });
    const adapter = adapterFor(conn.provider);
    const { isOrganizer, hasAttendees } = await adapter.getEventForEdit(conn, eventId);
    if (!isOrganizer) return NextResponse.json({ error: "not_organizer" }, { status: 403 });

    await adapter.cancelEvent(conn, eventId, { hasAttendees });

    await recordAudit({
      action: "workspace.event_cancel",
      resourceType: "workspace_event",
      resourceId: eventId,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, eventId, hasAttendees },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
