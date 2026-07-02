import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { requireClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { createNote } from "@/lib/crm/notes";
import { deriveNoteSubject } from "@/lib/crm/quick-note";
import { mapCrmNoteError } from "@/lib/crm/notes-route-errors";

export const dynamic = "force-dynamic";

const quickNoteSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  noteDate: z.iso.date(), // YYYY-MM-DD, advisor-local (client computes it)
});

/**
 * Quick-note creation addressed by PLANNING client id. The topbar only knows
 * the clientId from the URL, so the crmHouseholdId is resolved here rather
 * than threaded through app-wide chrome. CRM writes are own-firm only:
 * shared-in clients get the same 404 a nonexistent id would.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await requireClientAccess(id);
    if (access.access !== "own") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    await requireActiveSubscriptionForFirm(access.firmId);

    const input = quickNoteSchema.parse(await req.json());
    const note = await createNote(access.client.crmHouseholdId, access.firmId, userId, {
      subject: deriveNoteSubject(input.body),
      body: input.body,
      noteKind: "note",
      noteDate: input.noteDate,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    return mapCrmNoteError(err);
  }
}
