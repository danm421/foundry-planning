import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { setTaskStatus } from "@/lib/crm-tasks/mutations";
import { setCrmTaskStatusSchema } from "@/lib/crm-tasks/schemas";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    const body = setCrmTaskStatusSchema.parse(await req.json());
    const { task, followOnId } = await setTaskStatus(taskId, firmId, userId, body.status);
    return NextResponse.json({ task, followOnId });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
