import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { z } from "zod";
import {
  deleteCrmDocument,
  getCrmDocument,
  updateCrmDocument,
  resolveDocumentBlobPathname,
} from "@/lib/crm/documents";
import { ForbiddenError } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Stream a CRM household document to the caller. Authn/authz is enforced
 * by `getCrmDocument` (org-scoped via `requireVaultAccess`). The blob is
 * fetched server-side via `@vercel/blob`'s `get()` — we never expose the
 * raw blob URL to the client.
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

    const pathname = await resolveDocumentBlobPathname(doc);
    if (!pathname) {
      return NextResponse.json({ error: "Document is no longer available" }, { status: 410 });
    }
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Document blob not available" }, { status: 404 });
    }

    // Sanitize filename for the Content-Disposition header — quoted-string
    // grammar can't contain bare `"` or control chars. Strip the same way
    // we sanitize storage keys so the download name stays predictable.
    const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");

    const firmId = await requireOrgId();
    await recordAudit({
      action: "vault.document.download",
      resourceType: "crm_document",
      resourceId: doc.id,
      firmId,
      metadata: { householdId: doc.householdId, filename: doc.filename, kind: "single" },
    });

    return new Response(result.stream, {
      headers: {
        "Content-Type": doc.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
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
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
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
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("DELETE /api/crm/households/[id]/documents/[docId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PatchSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  filename: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const { id, docId } = await params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const doc = await updateCrmDocument(docId, parsed.data);
    if (doc.householdId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ document: doc });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : "error";
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    if (/required|folder/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
