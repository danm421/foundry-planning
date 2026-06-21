import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { familyMembers, familyRelationshipEnum } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate, recordDelete } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type Relationship = (typeof familyRelationshipEnum.enumValues)[number];

/** The four fields a portal client may edit on a family member. */
type EditableFields = {
  firstName: string;
  lastName: string | null;
  relationship: Relationship;
  dateOfBirth: string | null;
};

type RowWithFirmId = EditableFields & {
  id: string;
  clientId: string;
  firmId: string;
};

const FIELD_LABELS = {
  firstName: { label: "First name", format: "text" as const },
  lastName: { label: "Last name", format: "text" as const },
  relationship: { label: "Relationship", format: "text" as const },
  dateOfBirth: { label: "Date of birth", format: "text" as const },
};

/**
 * Load a family member row with the owning client's firmId in one query.
 * Uses a SQL subquery so we don't need a second round-trip for firmId.
 */
async function loadRow(rowId: string): Promise<RowWithFirmId | null> {
  const [row] = await db
    .select({
      id: familyMembers.id,
      clientId: familyMembers.clientId,
      firstName: familyMembers.firstName,
      lastName: familyMembers.lastName,
      relationship: familyMembers.relationship,
      dateOfBirth: familyMembers.dateOfBirth,
      firmId: sql<string>`(SELECT firm_id FROM clients WHERE id = ${familyMembers.clientId})`,
    })
    .from(familyMembers)
    .where(eq(familyMembers.id, rowId))
    .limit(1);
  return row ?? null;
}

function editable(row: EditableFields): EditableFields {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    relationship: row.relationship,
    dateOfBirth: row.dateOfBirth,
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

    const body = (await req.json().catch(() => ({}))) as Partial<EditableFields>;

    if (
      body.relationship !== undefined &&
      !(familyRelationshipEnum.enumValues as readonly string[]).includes(body.relationship)
    ) {
      return NextResponse.json({ error: "invalid relationship" }, { status: 400 });
    }

    const patch: Partial<{
      firstName: string;
      lastName: string | null;
      relationship: Relationship;
      dateOfBirth: string | null;
    }> = {};
    if (body.firstName !== undefined) patch.firstName = body.firstName;
    if (body.lastName !== undefined) patch.lastName = body.lastName;
    if (body.relationship !== undefined) patch.relationship = body.relationship as Relationship;
    if (body.dateOfBirth !== undefined) patch.dateOfBirth = body.dateOfBirth;

    await db.update(familyMembers).set(patch).where(eq(familyMembers.id, id));

    const before = editable(row);
    const after = { ...before, ...patch };

    await recordUpdate({
      action: "portal.family.update",
      resourceType: "family_member",
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

export async function DELETE(
  _req: Request,
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

    await db.delete(familyMembers).where(eq(familyMembers.id, id));

    const snapshot = editable(row);

    await recordDelete({
      action: "portal.family.delete",
      resourceType: "family_member",
      resourceId: id,
      clientId,
      firmId: row.firmId,
      actorKind: "client",
      snapshot,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
