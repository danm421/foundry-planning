import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { createEventSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Creates an event on one of the advisor's own connected accounts, optionally with a video meeting. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(createEventSchema, req);
    if (!parsed.ok) return parsed.response;
    const { connectionId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, connectionId });
    const { event, videoFailed } = await adapterFor(conn.provider).createEvent(conn, parsed.data);

    await recordAudit({
      action: "workspace.event_create",
      resourceType: "workspace_event",
      resourceId: event.id,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, eventId: event.id },
    });
    return NextResponse.json({ event, videoFailed }, { status: 201 });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
