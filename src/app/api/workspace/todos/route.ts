import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { normalizeQuickFilters } from "@/lib/crm-tasks/filters";
import { listTasks } from "@/lib/crm-tasks/queries";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { listActingConnections } from "@/lib/workspace/acting-connection";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { readTodos } from "@/lib/workspace/readers";
import { safeErrorFields, workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * Every connected account's open to-dos, or that account's error. An
 * impersonation session reads no account, and says so as `blocked`. Any other
 * failure to list the accounts (e.g. a row whose token won't decrypt) is
 * logged by name only and is `blocked: "unavailable"`, so the Foundry tasks
 * beside them still load.
 */
async function loadAccounts(
  firmId: string,
  userId: string,
): Promise<{ accounts: Awaited<ReturnType<typeof readTodos>>; blocked: "impersonating" | "unavailable" | null }> {
  try {
    const connections = await listActingConnections({ firmId, actorUserId: userId });
    return { accounts: await readTodos({ connections }), blocked: null };
  } catch (err) {
    if (err instanceof WorkspaceImpersonationError) return { accounts: [], blocked: "impersonating" };
    console.error("Workspace to-dos: accounts failed:", safeErrorFields(err));
    return { accounts: [], blocked: "unavailable" };
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
