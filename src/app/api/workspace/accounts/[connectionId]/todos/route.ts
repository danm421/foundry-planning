import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { adapterFor } from "@/lib/workspace/provider-adapter";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { createTodoSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** Adds a to-do to one of the advisor's own connected accounts (its default list). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(createTodoSchema, req);
    if (!parsed.ok) return parsed.response;
    const { connectionId } = await params;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, connectionId });
    const todo = await adapterFor(conn.provider).createTodo(conn, parsed.data);

    await recordAudit({
      action: "workspace.todo_create",
      resourceType: "workspace_todo",
      resourceId: todo.id,
      firmId,
      metadata: { provider: conn.provider, connectionId: conn.id, listId: todo.listId, taskId: todo.id },
    });
    return NextResponse.json({ todo }, { status: 201 });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
