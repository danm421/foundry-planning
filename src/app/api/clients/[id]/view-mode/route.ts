import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

const MODES = ["detailed", "map"] as const;
type ViewMode = (typeof MODES)[number];

function isViewMode(v: unknown): v is ViewMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

/**
 * Which Details surface this household opens in. Narrow on purpose: the general
 * client PUT mirrors identity onto CRM contacts and recomputes the plan horizon,
 * none of which should fire because someone clicked a view toggle.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { firmId } = await requireClientEditAccess(id);

    const body = await request.json();
    if (!isViewMode(body?.mode)) {
      return NextResponse.json(
        { error: `mode must be one of: ${MODES.join(", ")}` },
        { status: 400 },
      );
    }

    await db
      .update(clients)
      .set({ detailsViewMode: body.mode, updatedAt: new Date() })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "client.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: { detailsViewMode: body.mode },
    });

    return NextResponse.json({ success: true, mode: body.mode });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("PATCH /api/clients/[id]/view-mode error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
