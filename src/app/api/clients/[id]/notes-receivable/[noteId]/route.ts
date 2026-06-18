import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  externalBeneficiaries,
  familyMembers,
  noteReceivableOwners,
  notesReceivable,
} from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { assertEntitiesInClient } from "@/lib/db-scoping";
import { recordUpdate, recordDelete } from "@/lib/audit";
import {
  NOTE_RECEIVABLE_FIELD_LABELS,
  toNoteReceivableSnapshot,
} from "@/lib/audit/snapshots/note-receivable";
import {
  noteReceivableUpdateSchema,
  type NoteReceivableOwnerInput,
} from "@/lib/schemas/note-receivable";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function validateOwnersBelongToClient(
  clientId: string,
  owners: NoteReceivableOwnerInput[],
): Promise<{ error: string } | null> {
  const familyIds = owners.map((o) => o.familyMemberId).filter((x): x is string => !!x);
  const entityIds = owners.map((o) => o.entityId).filter((x): x is string => !!x);
  const extIds = owners
    .map((o) => o.externalBeneficiaryId)
    .filter((x): x is string => !!x);

  if (familyIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, familyIds),
        ),
      );
    if (rows.length !== familyIds.length) {
      return { error: "Family member owner not found for this client" };
    }
  }
  if (entityIds.length > 0) {
    const check = await assertEntitiesInClient(clientId, entityIds);
    if (!check.ok) return { error: check.reason };
  }
  if (extIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, extIds),
        ),
      );
    if (rows.length !== extIds.length) {
      return { error: "External beneficiary owner not found for this client" };
    }
  }
  return null;
}

// PATCH /api/clients/[id]/notes-receivable/[noteId] — partial update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [before] = await db
      .select()
      .from(notesReceivable)
      .where(
        and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, id)),
      );
    if (!before) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = noteReceivableUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const i = parsed.data;

    if (i.owners !== undefined) {
      const ownerSum = i.owners.reduce((acc, o) => acc + o.percent, 0);
      if (Math.abs(ownerSum - 1) > 0.0001) {
        return NextResponse.json(
          { error: "Owner percents must sum to 1 (100%)" },
          { status: 400 },
        );
      }
      const ownerErr = await validateOwnersBelongToClient(id, i.owners);
      if (ownerErr) {
        return NextResponse.json({ error: ownerErr.error }, { status: 400 });
      }
    }

    if (i.linkedTrustEntityId) {
      const check = await assertEntitiesInClient(id, [i.linkedTrustEntityId]);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    const patch: Partial<typeof notesReceivable.$inferInsert> & {
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (i.name !== undefined) patch.name = i.name;
    if (i.faceValue !== undefined) patch.faceValue = String(i.faceValue);
    if (i.basis !== undefined) patch.basis = String(i.basis);
    if (i.asOfBalance !== undefined)
      patch.asOfBalance = i.asOfBalance != null ? String(i.asOfBalance) : null;
    if (i.balanceAsOfMonth !== undefined)
      patch.balanceAsOfMonth = i.balanceAsOfMonth ?? null;
    if (i.balanceAsOfYear !== undefined)
      patch.balanceAsOfYear = i.balanceAsOfYear ?? null;
    if (i.interestRate !== undefined) patch.interestRate = String(i.interestRate);
    if (i.paymentType !== undefined) patch.paymentType = i.paymentType;
    if (i.monthlyPayment !== undefined)
      patch.monthlyPayment =
        i.monthlyPayment != null ? String(i.monthlyPayment) : null;
    if (i.startYear !== undefined) patch.startYear = i.startYear;
    if (i.startMonth !== undefined) patch.startMonth = i.startMonth;
    if (i.startYearRef !== undefined) patch.startYearRef = i.startYearRef ?? null;
    if (i.termMonths !== undefined) patch.termMonths = i.termMonths;
    if (i.linkedTrustEntityId !== undefined)
      patch.linkedTrustEntityId = i.linkedTrustEntityId ?? null;

    let after: typeof notesReceivable.$inferSelect;
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(notesReceivable)
        .set(patch)
        .where(
          and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, id)),
        )
        .returning();
      after = result;

      if (i.owners !== undefined) {
        await tx
          .delete(noteReceivableOwners)
          .where(eq(noteReceivableOwners.noteReceivableId, noteId));
        for (const o of i.owners) {
          await tx.insert(noteReceivableOwners).values({
            noteReceivableId: noteId,
            familyMemberId: o.familyMemberId ?? null,
            entityId: o.entityId ?? null,
            externalBeneficiaryId: o.externalBeneficiaryId ?? null,
            percent: String(o.percent),
          });
        }
      }
    });

    await recordUpdate({
      action: "note_receivable.update",
      resourceType: "note_receivable",
      resourceId: noteId,
      clientId: id,
      firmId,
      before: await toNoteReceivableSnapshot(before),
      after: await toNoteReceivableSnapshot(after!),
      fieldLabels: NOTE_RECEIVABLE_FIELD_LABELS,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(after!);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/notes-receivable/[noteId] error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/clients/[id]/notes-receivable/[noteId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [existing] = await db
      .select()
      .from(notesReceivable)
      .where(
        and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, id)),
      );
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const snapshot = await toNoteReceivableSnapshot(existing);

    await db
      .delete(notesReceivable)
      .where(
        and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, id)),
      );

    await recordDelete({
      action: "note_receivable.delete",
      resourceType: "note_receivable",
      resourceId: noteId,
      clientId: id,
      firmId,
      snapshot,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/notes-receivable/[noteId] error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
