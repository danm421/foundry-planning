import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { listActingConnections } from "@/lib/workspace/acting-connection";
import { WorkspaceNotConnectedError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { updateTodo } from "@/lib/workspace/microsoft/todo";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { updateTodoSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Edits or completes one of the advisor's own Microsoft To Do tasks. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ listId: string; taskId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(updateTodoSchema, req);
    if (!parsed.ok) return parsed.response;
    const { listId, taskId } = await params;

    // replaced in Task 9
    const [conn] = await listActingConnections({ firmId, actorUserId: userId });
    if (!conn) throw new WorkspaceNotConnectedError("connect");
    const ctx: GraphContext = { conn };
    await updateTodo(ctx, { listId, taskId, patch: parsed.data });

    await recordAudit({
      action: "workspace.todo_update",
      resourceType: "workspace_todo",
      resourceId: taskId,
      firmId,
      metadata: { listId, taskId, completed: parsed.data.completed },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
