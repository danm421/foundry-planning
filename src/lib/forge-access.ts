// src/lib/forge-access.ts
//
// Gate for read-only Forge surfaces outside the chat stream (the Knowledge
// Hub's video + poster routes). Same order and responses as
// /api/forge/stream: flag → org → subscription → user → entitlement. The
// stream routes keep their inline copy because it is interleaved with the
// claim reads they need (firm name, advisor name).
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscription } from "@/lib/authz";
import { hasForgeEntitlement, isForgeEnabled } from "@/domain/forge/flag";

/** null = proceed; otherwise the Response to send. */
export async function forgeViewerGate(): Promise<Response | null> {
  if (!isForgeEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgId();
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const entitlements = (sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null)
      ?.org_public_metadata?.entitlements;
    if (!hasForgeEntitlement(entitlements)) {
      return Response.json({ error: "Forge is not enabled for your plan." }, { status: 403 });
    }
    return null;
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return Response.json(mapped.body, { status: mapped.status });
    throw err;
  }
}
