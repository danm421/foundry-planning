import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/schemas/common";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import { listPortalDocuments, registerPortalUpload } from "@/lib/portal/vault-documents";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A file the browser already uploaded to Blob via `upload-token`. */
const RegisterSchema = z.object({
  pathname: z.string().min(1).max(1024),
  filename: z.string().trim().min(1).max(255),
  folderId: z.string().uuid().nullable().default(null),
});

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

    const parsed = await parseBody(RegisterSchema, req);
    if (!parsed.ok) return parsed.response;

    const document = await registerPortalUpload(parsed.data);
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/unsupported|unsafe/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("POST /api/portal/documents error:", msg.slice(0, 200));
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
