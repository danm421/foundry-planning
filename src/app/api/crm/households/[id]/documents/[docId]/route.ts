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
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const { id, docId } = await params;
    const doc = await getCrmDocument(docId);

    // Defense-in-depth: the URL's householdId must match the doc's
    // householdId. Without this, a same-firm caller could request a doc
    // from a different household via this URL. Return 404 (not 403) to
    // avoid leaking the existence of cross-household docs.
    if (doc.householdId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const { id, docId } = await params;

    // Defense-in-depth: fetch first to verify the URL's householdId
    // matches the doc's. Same rationale as the GET handler — return 404
    // on mismatch so we don't leak cross-household doc existence.
    const doc = await getCrmDocument(docId);
    if (doc.householdId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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
