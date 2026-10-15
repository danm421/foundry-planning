import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notesReceivable } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordDelete } from "@/lib/audit";
import { toNoteReceivableSnapshot } from "@/lib/audit/snapshots/note-receivable";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { noteUpdateRefusal, updateNoteReceivableForClient } from "@/lib/clients/notes-receivable-writes";

export const dynamic = "force-dynamic";

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

    const refusal = await noteUpdateRefusal(id, noteId);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

    const result = await updateNoteReceivableForClient({
      clientId: id,
      firmId,
      noteId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
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
