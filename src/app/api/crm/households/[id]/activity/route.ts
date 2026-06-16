import { NextRequest, NextResponse } from "next/server";
import { listActivity, recordActivity } from "@/lib/crm/activity";
import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { createCrmActivitySchema } from "@/lib/crm/schemas";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireCrmHouseholdAccess(id);
    const { searchParams } = new URL(req.url);
    const rows = await listActivity(id, {
      limit: Number(searchParams.get("limit") ?? 50),
      offset: Number(searchParams.get("offset") ?? 0),
    });
    return NextResponse.json({ activity: rows });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("GET /api/crm/households/[id]/activity error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireCrmHouseholdAccess(id);
    const body = await req.json();
    const parsed = createCrmActivitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { userId } = await auth();
    await recordActivity(
      {
        householdId: id,
        kind: parsed.data.kind,
        title: parsed.data.title,
        body: parsed.data.body,
        metadata: parsed.data.metadata,
        occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      },
      { actorUserId: userId ?? "" },
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("POST /api/crm/households/[id]/activity error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
