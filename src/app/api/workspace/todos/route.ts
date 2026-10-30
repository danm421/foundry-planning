import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { normalizeQuickFilters } from "@/lib/crm-tasks/filters";
import { listTasks } from "@/lib/crm-tasks/queries";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { listActingConnections } from "@/lib/workspace/acting-connection";
import { WorkspaceImpersonationError, WorkspaceNotConnectedError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { createTodo } from "@/lib/workspace/microsoft/todo";
import { readTodos } from "@/lib/workspace/readers";
import { safeErrorFields, workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { createTodoSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/**
 * Every connected account's open to-dos, or that account's error. An
 * impersonation session reads no account, and says so as `blocked`. Any other
 * failure to list the accounts (e.g. a row whose token won't decrypt) is
 * logged by name only and reads as no accounts, so the Foundry tasks beside
 * them still load.
 */
async function loadAccounts(
  firmId: string,
  userId: string,
): Promise<{ accounts: Awaited<ReturnType<typeof readTodos>>; blocked: "impersonating" | null }> {
  try {
    const connections = await listActingConnections({ firmId, actorUserId: userId });
    return { accounts: await readTodos({ connections }), blocked: null };
  } catch (err) {
    if (err instanceof WorkspaceImpersonationError) return { accounts: [], blocked: "impersonating" };
    console.error("Workspace to-dos: accounts failed:", safeErrorFields(err));
    return { accounts: [], blocked: null };
  }
}

/** The advisor's open Foundry tasks plus every connected account's open to-dos. */
export async function GET(): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();

    const [foundry, accountSide] = await Promise.all([
      listTasks(
        firmId,
        { userId, orgRole },
        {},
        normalizeQuickFilters({ quick: "mine", explicitAssignee: null, currentUserId: userId }),
      ),
      loadAccounts(firmId, userId),
    ]);
    return NextResponse.json({ foundry, ...accountSide });
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

    // replaced in Task 9
    const [conn] = await listActingConnections({ firmId, actorUserId: userId });
    if (!conn) throw new WorkspaceNotConnectedError("connect");
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
