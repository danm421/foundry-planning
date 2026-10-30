import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { moveEventSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Moves an event the advisor organizes, on the account that holds it; the provider notifies the attendees. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ connectionId: string; eventId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(moveEventSchema, req);
    if (!parsed.ok) return parsed.response;
    const { connectionId, eventId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, connectionId });
    const adapter = adapterFor(conn.provider);
    const { isOrganizer } = await adapter.getEventForEdit(conn, eventId);
    if (!isOrganizer) return NextResponse.json({ error: "not_organizer" }, { status: 403 });

    const event = await adapter.moveEvent(conn, eventId, parsed.data);

    await recordAudit({
      action: "workspace.event_move",
      resourceType: "workspace_event",
      resourceId: eventId,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, eventId },
    });
    return NextResponse.json({ event });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
