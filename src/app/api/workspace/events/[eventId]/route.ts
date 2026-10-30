import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { listActingConnections } from "@/lib/workspace/acting-connection";
import { WorkspaceNotConnectedError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { getEventForEdit, getMailboxTimeZone, moveEvent } from "@/lib/workspace/microsoft/calendar";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { moveEventSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Moves an event the advisor organizes; Outlook notifies the attendees. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(moveEventSchema, req);
    if (!parsed.ok) return parsed.response;
    const { eventId } = await params;

    // replaced in Task 9
    const [conn] = await listActingConnections({ firmId, actorUserId: userId });
    if (!conn) throw new WorkspaceNotConnectedError("connect");
    const ctx: GraphContext = { conn };
    const { isOrganizer } = await getEventForEdit(ctx, eventId);
    if (!isOrganizer) return NextResponse.json({ error: "not_organizer" }, { status: 403 });

    const timeZone = await getMailboxTimeZone(ctx);
    const event = await moveEvent(ctx, eventId, { ...parsed.data, timeZone });

    await recordAudit({
      action: "workspace.event_move",
      resourceType: "workspace_event",
      resourceId: eventId,
      firmId,
      metadata: { eventId },
    });
    return NextResponse.json({ event });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
