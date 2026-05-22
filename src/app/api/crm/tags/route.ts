import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { listFirmTags } from "@/lib/crm-tasks/queries";
import { createTag } from "@/lib/crm-tasks/mutations";
import { createCrmTagSchema } from "@/lib/crm-tasks/schemas";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tags = await listFirmTags(firmId);
    return NextResponse.json({ tags });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = createCrmTagSchema.parse(await req.json());
    const tag = await createTag(firmId, body);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
