import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { parseBody } from "@/lib/schemas/common";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { microsoftAppConfig } from "@/lib/workspace/microsoft/config";
import { buildAdminConsentUrl } from "@/lib/workspace/microsoft/oauth";
import { createWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * `redirect`: the admin approves in this tab, right now. `link`: the admin
 * sends the URL to their IT person, who may take days to get to it.
 */
const TTL_MS = { redirect: 10 * 60 * 1000, link: 7 * 24 * 3600 * 1000 } as const;

const bodySchema = z.object({ mode: z.enum(["redirect", "link"]) });

/** Mints a single-use admin-consent state and returns Microsoft's approval URL for it. */
export async function POST(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await requireOrgAndUser();

    const parsed = await parseBody(bodySchema, req);
    if (!parsed.ok) return parsed.response;
    const { mode } = parsed.data;

    const rl = await checkIntegrationOauthLimit(`ms_consent:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many Microsoft 365 approval attempts. Please try again shortly.");
    }

    // Throws before the state is written when the Microsoft app isn't
    // configured, so a misconfigured deploy leaves no orphan state rows.
    microsoftAppConfig();
    const state = await createWorkspaceOauthState({
      firmId,
      provider: "microsoft",
      kind: "admin_consent",
      userId,
      codeVerifier: null,
      ttlMs: TTL_MS[mode],
    });
    return NextResponse.json({ url: buildAdminConsentUrl({ state }) });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
