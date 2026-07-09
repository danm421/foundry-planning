import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { getPortalClientId } from "@/lib/portal/get-portal-client";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { PORTAL_AS_CLIENT_HEADER } from "@/lib/portal/portal-as-client-header";
import type { PortalActorMode } from "@/lib/portal/contracts";
export type { PortalActorMode };

/**
 * Portal identity resolver for `/api/portal/*` route handlers.
 *
 * - Real client (no orgId): clientId from the clerkUserId binding. The
 *   `x-portal-as-client` header is IGNORED — a client cannot act as another.
 * - Advisor (orgId present): "act as client" preview. The target clientId comes
 *   from the header and is validated with `requireClientEditAccess` (firm/share
 *   edit scope). Read-only portal routes (e.g. GET /api/portal/me, /dashboard)
 *   intentionally require edit access too, mirroring the web act-as preview: an
 *   advisor with only view-share access cannot load the preview (fail-closed).
 */
export async function resolvePortalClient(): Promise<{
  clientId: string;
  mode: PortalActorMode;
  clerkUserId: string;
}> {
  const { userId, orgId } = await auth();
  if (!userId) throw new UnauthorizedError();

  if (!orgId) {
    const clientId = await getPortalClientId(userId);
    if (!clientId) throw new ForbiddenError("No portal binding for this user");
    return { clientId, mode: "client", clerkUserId: userId };
  }

  const target = (await headers()).get(PORTAL_AS_CLIENT_HEADER);
  if (!target) {
    throw new ForbiddenError("Advisor session — portal access denied");
  }
  await requireClientEditAccess(target);
  return { clientId: target, mode: "advisor", clerkUserId: userId };
}
