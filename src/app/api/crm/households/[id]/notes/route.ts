import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { createCrmNoteSchema } from "@/lib/crm/schemas";
import { createNote, listHouseholdNotes } from "@/lib/crm/notes";
import { mapCrmNoteError } from "@/lib/crm/notes-route-errors";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    const notes = await listHouseholdNotes(id, orgId);
    return NextResponse.json({ notes });
  } catch (err) {
    return mapCrmNoteError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = createCrmNoteSchema.parse(await req.json());
    const note = await createNote(id, orgId, userId, input);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return mapCrmNoteError(err);
  }
}
