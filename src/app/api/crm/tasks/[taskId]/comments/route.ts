import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { listTaskComments } from "@/lib/crm-tasks/queries";
import { postComment } from "@/lib/crm-tasks/mutations";
import { postCrmTaskCommentSchema } from "@/lib/crm-tasks/schemas";
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
    const comments = await listTaskComments(taskId);
    return NextResponse.json({ comments });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    const body = postCrmTaskCommentSchema.parse(await req.json());
    const comment = await postComment(taskId, firmId, userId, body.bodyMarkdown);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
