import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import { updatePortalFolder, deletePortalFolder } from "@/lib/portal/vault-folders";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentFolderId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ folderId: string }> }): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { folderId } = await ctx.params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const folder = await updatePortalFolder(folderId, parsed.data);
    return NextResponse.json({ folder });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/required|cycle|cannot modify/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ folderId: string }> }): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { folderId } = await ctx.params;
    await deletePortalFolder(folderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/cannot delete/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
