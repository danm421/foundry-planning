import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/schemas/common";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { portalVaultErrorResponse } from "@/lib/portal/vault-context";
import { preparePortalUpload } from "@/lib/portal/vault-documents";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  folderId: z.string().uuid().nullable().default(null),
});

/** Issues a one-file Blob token; the browser then uploads straight to Blob. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const parsed = await parseBody(BodySchema, req);
    if (!parsed.ok) return parsed.response;
    return NextResponse.json(await preparePortalUpload(parsed.data));
  } catch (err) {
    const r = portalVaultErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/documents/upload-token error:", (err instanceof Error ? err.message : "error").slice(0, 200));
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
