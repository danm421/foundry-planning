import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { deleteCrmTaskFile } from "@/lib/crm-tasks/files";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; fileId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId, fileId } = await params;
    await requireCrmTaskAccess(taskId);

    await deleteCrmTaskFile({ fileId, taskId, firmId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
