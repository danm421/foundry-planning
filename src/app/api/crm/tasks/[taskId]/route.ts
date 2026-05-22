import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { getTaskById } from "@/lib/crm-tasks/queries";
import { deleteTask, updateTaskField } from "@/lib/crm-tasks/mutations";
import { updateCrmTaskFieldSchema } from "@/lib/crm-tasks/schemas";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    const result = await getTaskById(taskId, firmId);
    if (!result) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ task: result.task, tags: result.tags });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    const body = updateCrmTaskFieldSchema.parse(await req.json());
    const task = await updateTaskField(taskId, firmId, userId, body);
    return NextResponse.json({ task });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    await deleteTask(taskId, firmId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
