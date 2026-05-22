import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { detachTag } from "@/lib/crm-tasks/mutations";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; tagId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId, tagId } = await params;
    await detachTag(taskId, firmId, tagId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
