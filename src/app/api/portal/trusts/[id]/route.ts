import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type EditableFields = {
  name: string;
};

type RowWithFirmId = EditableFields & {
  id: string;
  clientId: string;
  firmId: string;
};

const FIELD_LABELS = {
  name: { label: "Name", format: "text" as const },
};

async function loadRow(rowId: string): Promise<RowWithFirmId | null> {
  const [row] = await db
    .select({
      id: entities.id,
      clientId: entities.clientId,
      name: entities.name,
      firmId: sql<string>`(SELECT firm_id FROM clients WHERE id = ${entities.clientId})`,
    })
    .from(entities)
    .where(eq(entities.id, rowId))
    .limit(1);
  return row ?? null;
}

function editable(row: EditableFields): EditableFields {
  return {
    name: row.name,
  };
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const { id } = await ctx.params;
    const row = await loadRow(id);
    if (!row || row.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Partial<{ name: string }> = {};
    if (typeof body.name === "string") patch.name = body.name;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, noop: true });
    }

    await db.update(entities).set(patch).where(eq(entities.id, id));

    const before = editable(row);
    const after = { ...before, ...patch };

    await recordUpdate({
      action: "portal.trust.update",
      resourceType: "entity",
      resourceId: id,
      clientId,
      firmId: row.firmId,
      actorKind: "client",
      before,
      after,
      fieldLabels: FIELD_LABELS,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
