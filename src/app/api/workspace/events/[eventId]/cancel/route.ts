import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { cancelEvent, getEventForEdit } from "@/lib/workspace/microsoft/calendar";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** Cancels an event the advisor organizes (attendees are notified when there are any). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { eventId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, provider: "microsoft" });
    const ctx: GraphContext = { conn };
    const { isOrganizer, hasAttendees } = await getEventForEdit(ctx, eventId);
    if (!isOrganizer) return NextResponse.json({ error: "not_organizer" }, { status: 403 });

    await cancelEvent(ctx, eventId, { hasAttendees });

    await recordAudit({
      action: "workspace.event_cancel",
      resourceType: "workspace_event",
      resourceId: eventId,
      firmId,
      metadata: { eventId, hasAttendees },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
