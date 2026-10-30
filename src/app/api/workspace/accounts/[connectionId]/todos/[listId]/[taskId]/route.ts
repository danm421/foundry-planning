import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { updateTodoSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Edits or completes one to-do on one of the advisor's own connected accounts. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ connectionId: string; listId: string; taskId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(updateTodoSchema, req);
    if (!parsed.ok) return parsed.response;
    const { connectionId, listId, taskId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, connectionId });
    await adapterFor(conn.provider).updateTodo(conn, { listId, taskId, patch: parsed.data });

    await recordAudit({
      action: "workspace.todo_update",
      resourceType: "workspace_todo",
      resourceId: taskId,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, listId, taskId, completed: parsed.data.completed },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
