import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import {
  deleteCrmDocument,
  getCrmDocument,
} from "@/lib/crm/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Stream a CRM household document to the caller. Authn/authz is enforced
 * by `getCrmDocument` (org-scoped via `requireCrmHouseholdAccess`). The
 * blob is fetched server-side via `@vercel/blob`'s `get()` — we never
 * expose the raw blob URL to the client.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const doc = await getCrmDocument(docId);

    const result = await get(doc.storageKey, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Document blob not available" }, { status: 404 });
    }

    // Sanitize filename for the Content-Disposition header — quoted-string
    // grammar can't contain bare `"` or control chars. Strip the same way
    // we sanitize storage keys so the download name stays predictable.
    const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");

    return new Response(result.stream, {
      headers: {
        "Content-Type": doc.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      (err.message === "Document not found" ||
        err.message.startsWith("CRM household not found or access denied"))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("GET /api/crm/households/[id]/documents/[docId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    await deleteCrmDocument(docId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      (err.message === "Document not found" ||
        err.message.startsWith("CRM household not found or access denied"))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/crm/households/[id]/documents/[docId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
