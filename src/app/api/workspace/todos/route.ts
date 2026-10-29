import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { normalizeQuickFilters } from "@/lib/crm-tasks/filters";
import { listTasks } from "@/lib/crm-tasks/queries";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import {
  ProviderThrottledError,
  WorkspaceNotConnectedError,
  WorkspaceReconnectRequiredError,
} from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { createTodo, listOpenTodos } from "@/lib/workspace/microsoft/todo";
import { safeErrorFields, workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { createTodoSchema } from "@/lib/workspace/schemas";
import type { OutlookError, WorkspaceTodo } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/**
 * The Microsoft half of the list. Any failure here degrades to an
 * `outlookError` so the Foundry tasks still show: "throttled" ("Microsoft is
 * busy") for throttling only, "unavailable" for any other failure, which is
 * logged by name (plus Graph status / request-id) only.
 */
async function loadOutlook(
  firmId: string,
  userId: string,
): Promise<{ outlook: WorkspaceTodo[]; outlookError: null } | { outlook: null; outlookError: OutlookError }> {
  try {
    const conn = await resolveActingConnection({ firmId, actorUserId: userId, provider: "microsoft" });
    return { outlook: await listOpenTodos({ conn }), outlookError: null };
  } catch (err) {
    if (err instanceof WorkspaceNotConnectedError) return { outlook: null, outlookError: "not_connected" };
    if (err instanceof WorkspaceReconnectRequiredError) return { outlook: null, outlookError: "needs_reconnect" };
    if (err instanceof ProviderThrottledError) return { outlook: null, outlookError: "throttled" };
    console.error("Workspace to-dos: Microsoft side failed:", safeErrorFields(err));
    return { outlook: null, outlookError: "unavailable" };
  }
}

/** The advisor's Foundry tasks plus their open Outlook to-dos. */
export async function GET(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();

    const [foundry, outlookSide] = await Promise.all([
      listTasks(
        firmId,
        { userId, orgRole },
        {},
        normalizeQuickFilters({ quick: "mine", explicitAssignee: null, currentUserId: userId }),
      ),
      loadOutlook(firmId, userId),
    ]);
    return NextResponse.json({ foundry, ...outlookSide });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

/** Adds a to-do to the advisor's default Microsoft To Do list. */
export async function POST(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(createTodoSchema, req);
    if (!parsed.ok) return parsed.response;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, provider: "microsoft" });
    const ctx: GraphContext = { conn };
    const todo = await createTodo(ctx, parsed.data);

    await recordAudit({
      action: "workspace.todo_create",
      resourceType: "workspace_todo",
      resourceId: todo.id,
      firmId,
      metadata: { listId: todo.listId, taskId: todo.id },
    });
    return NextResponse.json({ todo }, { status: 201 });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
