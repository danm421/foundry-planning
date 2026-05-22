import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { attachTag } from "@/lib/crm-tasks/mutations";
import { attachCrmTagSchema } from "@/lib/crm-tasks/schemas";
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
    const body = attachCrmTagSchema.parse(await req.json());
    await attachTag(taskId, firmId, body.tagId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
