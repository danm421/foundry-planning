import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { listTaskActivity } from "@/lib/crm-tasks/queries";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    await requireCrmTaskAccess(taskId);

    const rows = await listTaskActivity(taskId);
    const actorIds = Array.from(new Set(rows.map((r) => r.userId)));
    const actors = await resolveActors(actorIds);
    const decorated = rows.map((r) => ({
      ...r,
      userName: actors.get(r.userId)?.name ?? r.userId,
    }));
    return NextResponse.json({ activity: decorated });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
