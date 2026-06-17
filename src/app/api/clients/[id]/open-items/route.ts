import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientOpenItems } from "@/db/schema";
import { and, desc, eq, isNull, asc, gte, or } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { openItemCreateSchema } from "@/lib/schemas/open-items";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const rows = await db
      .select()
      .from(clientOpenItems)
      .where(
        and(
          eq(clientOpenItems.clientId, id),
          or(
            isNull(clientOpenItems.completedAt),
            gte(clientOpenItems.completedAt, cutoff),
          ),
        ),
      )
      .orderBy(
        asc(clientOpenItems.completedAt), // nulls first → open items first
        desc(clientOpenItems.priority),
        asc(clientOpenItems.dueDate),
      );

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/open-items error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const parsed = await parseBody(openItemCreateSchema, request);
    if (!parsed.ok) return parsed.response;

    const [row] = await db
      .insert(clientOpenItems)
      .values({
        clientId: id,
        title: parsed.data.title,
        priority: parsed.data.priority,
        dueDate: parsed.data.dueDate ?? null,
      })
      .returning();

    await recordAudit({
      action: "open_item.create",
      resourceType: "open_item",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: { priority: row.priority },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/open-items error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
