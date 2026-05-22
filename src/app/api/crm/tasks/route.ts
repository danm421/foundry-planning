import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { listTasks } from "@/lib/crm-tasks/queries";
import { createTask } from "@/lib/crm-tasks/mutations";
import { createCrmTaskSchema } from "@/lib/crm-tasks/schemas";
import { normalizeQuickFilters, type TaskQuickFilter } from "@/lib/crm-tasks/filters";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

const QUICK: ReadonlyArray<TaskQuickFilter> = ["all", "mine", "open", "overdue", "done"];

export async function GET(req: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const rawQuick = sp.get("quick");
    const quick = rawQuick && QUICK.includes(rawQuick as TaskQuickFilter)
      ? (rawQuick as TaskQuickFilter)
      : null;
    const filters = normalizeQuickFilters({
      quick,
      explicitAssignee: sp.get("assignee"),
      currentUserId: userId,
    });
    const scope = {
      householdId: sp.get("householdId") || undefined,
      tagId: sp.get("tagId") || undefined,
      priority: (sp.get("priority") as "low" | "med" | "high" | null) || undefined,
    };
    const rows = await listTasks(firmId, scope, filters);
    return NextResponse.json({ tasks: rows });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = createCrmTaskSchema.parse(await req.json());
    const task = await createTask(firmId, userId, body);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
