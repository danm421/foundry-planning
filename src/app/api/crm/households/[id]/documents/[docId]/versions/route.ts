import { NextRequest, NextResponse } from "next/server";
import { listDocumentVersions } from "@/lib/crm/documents";
import { authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const { id, docId } = await params;
    const versions = await listDocumentVersions(docId);
    if (versions[0] && versions[0].householdId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ versions });
  } catch (err) {
    const authed = authErrorResponse(err);
    if (authed) return NextResponse.json(authed.body, { status: authed.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
