import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  noteExtraPayments,
  notesReceivable,
} from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { noteReceivableExtraPaymentsReplaceSchema } from "@/lib/schemas/note-receivable";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/notes-receivable/[noteId]/extra-payments
//   — bulk-replace the note's extra-payment rows
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [note] = await db
      .select({ id: notesReceivable.id })
      .from(notesReceivable)
      .where(
        and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, id)),
      );
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = noteReceivableExtraPaymentsReplaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(noteExtraPayments)
        .where(eq(noteExtraPayments.noteReceivableId, noteId));
      if (parsed.data.length > 0) {
        await tx.insert(noteExtraPayments).values(
          parsed.data.map((ep) => ({
            noteReceivableId: noteId,
            year: ep.year,
            type: ep.type,
            amount: String(ep.amount),
          })),
        );
      }
    });

    await recordAudit({
      action: "note_receivable.extra_payments.replace",
      resourceType: "note_receivable",
      resourceId: noteId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { count: parsed.data.length }),
    });

    return NextResponse.json({ ok: true, count: parsed.data.length });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/notes-receivable/[noteId]/extra-payments error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
