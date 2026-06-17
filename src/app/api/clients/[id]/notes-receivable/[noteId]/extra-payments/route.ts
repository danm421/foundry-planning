import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  noteExtraPayments,
  notesReceivable,
} from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { noteReceivableExtraPaymentsReplaceSchema } from "@/lib/schemas/note-receivable";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/notes-receivable/[noteId]/extra-payments
//   — bulk-replace the note's extra-payment rows
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, noteId } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

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
      metadata: { count: parsed.data.length },
    });

    return NextResponse.json({ ok: true, count: parsed.data.length });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
