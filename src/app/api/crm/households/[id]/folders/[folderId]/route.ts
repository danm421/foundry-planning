import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateFolder, deleteFolder } from "@/lib/crm/folders";
import { authErrorResponse } from "@/lib/authz";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
});

function mapError(err: unknown): NextResponse {
  const authed = authErrorResponse(err);
  if (authed) return NextResponse.json(authed.body, { status: authed.status });
  const msg = err instanceof Error ? err.message : "Unknown error";
  if (/do not have access/i.test(msg)) return NextResponse.json({ error: msg }, { status: 403 });
  if (/system folder|cycle|required/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
  if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  try {
    const { id, folderId } = await params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const folder = await updateFolder(id, folderId, parsed.data);
    return NextResponse.json({ folder });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  try {
    const { id, folderId } = await params;
    await deleteFolder(id, folderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapError(err);
  }
}
