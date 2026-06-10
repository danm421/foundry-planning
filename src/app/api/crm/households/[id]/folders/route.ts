import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listFolders, createFolder } from "@/lib/crm/folders";
import { authErrorResponse } from "@/lib/authz";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.string().uuid().nullable().optional(),
});

function mapError(err: unknown): NextResponse {
  const authed = authErrorResponse(err);
  if (authed) return NextResponse.json(authed.body, { status: authed.status });
  const msg = err instanceof Error ? err.message : "Unknown error";
  if (/not found or access denied|do not have access/i.test(msg)) {
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
  if (/required|cycle|system folder/i.test(msg)) {
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const folders = await listFolders(id);
    return NextResponse.json({ folders });
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const folder = await createFolder(id, parsed.data);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
