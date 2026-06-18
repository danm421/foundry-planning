import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireShareManageAccess } from "@/lib/clients/share-manage";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { firmId } = await requireShareManageAccess(id);

    const body = await request.json();
    if (typeof body?.isPrivate !== "boolean") {
      return NextResponse.json(
        { error: "isPrivate must be a boolean" },
        { status: 400 },
      );
    }

    await db
      .update(clients)
      .set({ isPrivate: body.isPrivate, updatedAt: new Date() })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "client.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: { isPrivate: body.isPrivate },
    });

    return NextResponse.json({ success: true, isPrivate: body.isPrivate });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("PUT /api/clients/[id]/privacy error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
