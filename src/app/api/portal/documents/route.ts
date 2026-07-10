import { NextRequest, NextResponse } from "next/server";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import { listPortalDocuments, uploadPortalDocument } from "@/lib/portal/vault-documents";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const raw = req.nextUrl.searchParams.get("folderId");
    const folderId = !raw || raw === "root" ? null : raw;
    const documents = await listPortalDocuments(folderId);
    return NextResponse.json({ documents });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/portal/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENT_SIZE_BYTES + 65536) {
      return NextResponse.json({ error: "File too large. Maximum size is 10MB." }, { status: 413 });
    }
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return NextResponse.json({ error: "File too large. Maximum size is 10MB." }, { status: 413 });
    }
    const folderRaw = formData.get("folderId");
    const folderId = typeof folderRaw === "string" && folderRaw !== "" && folderRaw !== "root" ? folderRaw : null;

    const document = await uploadPortalDocument(file, { folderId });
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/too large/i.test(msg)) return NextResponse.json({ error: msg }, { status: 413 });
    if (/unsupported|unsafe/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("POST /api/portal/documents error:", msg.slice(0, 200));
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
