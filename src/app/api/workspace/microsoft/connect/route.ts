import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { generatePkce } from "@/lib/integrations/pkce";
import { checkIntegrationOauthLimit } from "@/lib/rate-limit";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { microsoftAppConfig } from "@/lib/workspace/microsoft/config";
import { buildAuthorizeUrl } from "@/lib/workspace/microsoft/oauth";
import { createWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo, workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Starts an advisor's own Microsoft sign-in (authorization code + PKCE) at any
 * organization; no firm approval or per-advisor switch is needed. `?hint=` (a
 * reconnect's address) pre-fills the sign-in when it's an email. The Workspace
 * page links here, so impersonation, a rate limit or a server failure (missing
 * config, the database) redirects back to a banner, never JSON in the tab.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    if (await isImpersonating()) return redirectTo(req, "/workspace?error=impersonating");

    const rl = await checkIntegrationOauthLimit(`ms_connect:${userId}`);
    if (!rl.allowed) return redirectTo(req, "/workspace?error=connect_failed");

    // Throws before the state is written when the Microsoft app isn't
    // configured, so a misconfigured deploy leaves no orphan state rows.
    microsoftAppConfig();
    const { verifier, challenge } = generatePkce();
    const state = await createWorkspaceOauthState({
      firmId,
      provider: "microsoft",
      kind: "user_connect",
      userId,
      codeVerifier: verifier,
      ttlMs: STATE_TTL_MS,
    });
    const loginHint = z.email().safeParse(new URL(req.url).searchParams.get("hint")).data;
    return NextResponse.redirect(buildAuthorizeUrl({ state, challenge, loginHint }), 307);
  } catch (err) {
    // Logged (name only) by the mapper; a server failure goes back to the banner.
    const res = workspaceErrorResponse(err);
    return res.status >= 500 ? redirectTo(req, "/workspace?error=connect_failed") : res;
  }
}
