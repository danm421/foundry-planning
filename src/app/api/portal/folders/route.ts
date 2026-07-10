import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import { listPortalFolders, createPortalFolder } from "@/lib/portal/vault-folders";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.string().uuid().nullable().optional(),
});

export async function GET(): Promise<Response> {
  try {
    const { rootId, folders } = await listPortalFolders();
    return NextResponse.json({ rootId, folders });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const folder = await createPortalFolder({
      name: parsed.data.name,
      parentFolderId: parsed.data.parentFolderId ?? null,
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/required|cycle/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
