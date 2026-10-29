import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { generatePkce } from "@/lib/integrations/pkce";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { hasMemberAccess } from "@/lib/workspace/access";
import { getFirmApproval } from "@/lib/workspace/approvals";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { microsoftAppConfig } from "@/lib/workspace/microsoft/config";
import { buildAuthorizeUrl } from "@/lib/workspace/microsoft/oauth";
import { createWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo, workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Starts a switched-on advisor's own Microsoft sign-in (authorization code +
 * PKCE) on the firm's approved tenant. The Workspace page links here.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();

    const approval = await getFirmApproval(firmId, "microsoft");
    if (!approval) return redirectTo(req, "/workspace?error=firm_not_approved");
    if (!(await hasMemberAccess(firmId, userId, "microsoft"))) {
      return redirectTo(req, "/workspace?error=member_off");
    }

    const rl = await checkIntegrationOauthLimit(`ms_connect:${userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many Microsoft 365 sign-in attempts. Please try again shortly.");
    }

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
    return NextResponse.redirect(buildAuthorizeUrl({ tenantId: approval.tenantId, state, challenge }), 307);
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
