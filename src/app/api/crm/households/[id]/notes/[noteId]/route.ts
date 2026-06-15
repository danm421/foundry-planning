import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { updateCrmNoteSchema } from "@/lib/crm/schemas";
import { deleteNote, updateNote } from "@/lib/crm/notes";
import { mapCrmNoteError } from "@/lib/crm/notes-route-errors";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = updateCrmNoteSchema.parse(await req.json());
    const note = await updateNote(noteId, id, orgId, userId, input);
    return NextResponse.json({ note });
  } catch (err) {
    return mapCrmNoteError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await deleteNote(noteId, id, orgId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmNoteError(err);
  }
}
