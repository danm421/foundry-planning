import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { upsertFirmApproval } from "@/lib/workspace/approvals";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { MICROSOFT_SCOPES } from "@/lib/workspace/microsoft/config";
import { consumeWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo, workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

type Result = "approved" | "declined" | "expired";

const SETTINGS_QUERY: Record<Result, string> = {
  approved: "approved=1",
  declined: "error=consent_declined",
  expired: "error=consent_expired",
};

/**
 * Entra tenant ids are GUIDs. Anything else — notably the multi-tenant aliases
 * `common` / `organizations` — would save an approval no advisor can sign in to.
 */
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Microsoft says the admin approved (no `error`, `admin_consent=True`). */
function consented(params: URLSearchParams): boolean {
  return !params.get("error") && params.get("admin_consent")?.toLowerCase() === "true";
}

/**
 * Where Microsoft returns an admin after admin consent. PUBLIC: the person
 * approving may be an IT admin with no Foundry account.
 *
 * - No `state` at all: the IT approval link an advisor sent
 *   (`buildItApprovalUrl`). It names no firm, so the result page shows and
 *   nothing is recorded.
 * - A `state`: an approval started from a firm's settings. The single-use
 *   state is the only credential, and the firm and acting admin come from it,
 *   never from a session.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const params = new URL(req.url).searchParams;
    const stateParam = params.get("state");
    if (stateParam === null) {
      const approved = consented(params) && TENANT_ID.test(params.get("tenant") ?? "");
      return redirectTo(req, `/microsoft-approval?result=${approved ? "approved" : "declined"}`);
    }
    const state = stateParam ? await consumeWorkspaceOauthState(stateParam) : null;
    if (!state || state.kind !== "admin_consent" || state.provider !== "microsoft") {
      // No valid state names no firm, so there is no settings page to return to.
      return redirectTo(req, "/microsoft-approval?result=expired");
    }

    const result = await settleConsent(state, params);
    const { orgId } = await auth();
    return redirectTo(
      req,
      orgId === state.firmId
        ? `/settings/integrations/microsoft_365?${SETTINGS_QUERY[result]}`
        : `/microsoft-approval?result=${result}`,
    );
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

async function settleConsent(
  state: { firmId: string; userId: string },
  params: URLSearchParams,
): Promise<Result> {
  if (!consented(params)) return "declined";
  const tenant = params.get("tenant") ?? "";
  if (!TENANT_ID.test(tenant)) return "expired";
  // Lower-cased to the form id_tokens carry in `tid`, so a case-only
  // difference can never read as a tenant change on re-approval.
  const tenantId = tenant.toLowerCase();

  await upsertFirmApproval({
    firmId: state.firmId,
    provider: "microsoft",
    tenantId,
    approvedScopes: MICROSOFT_SCOPES.join(" "),
    approvedByUserId: state.userId,
  });
  // Explicit firm and actor: the callback often runs with no session, and the
  // approval is the act of the admin who started it.
  await recordAudit({
    action: "workspace.firm_approve",
    resourceType: "workspace_firm_approval",
    resourceId: "microsoft",
    firmId: state.firmId,
    actorId: state.userId,
    metadata: { provider: "microsoft", tenantId },
  });
  return "approved";
}
