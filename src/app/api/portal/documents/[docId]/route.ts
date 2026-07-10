import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { z } from "zod";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import {
  getPortalDocumentForDownload,
  deletePortalDocument,
  updatePortalDocument,
} from "@/lib/portal/vault-documents";
import { toSafeDisplayFilename } from "@/lib/files/safe-filename";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  try {
    const { docId } = await ctx.params;
    const { pathname, filename, mimeType } = await getPortalDocumentForDownload(docId);
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        "Content-Type": mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${toSafeDisplayFilename(filename)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/portal/documents/[docId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PatchSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { docId } = await ctx.params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const document = await updatePortalDocument(docId, parsed.data);
    return NextResponse.json({ document });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/required|nothing to update/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { docId } = await ctx.params;
    await deletePortalDocument(docId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/portal/documents/[docId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
