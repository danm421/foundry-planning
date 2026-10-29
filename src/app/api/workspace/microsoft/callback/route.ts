import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { hasMemberAccess } from "@/lib/workspace/access";
import { getFirmApproval } from "@/lib/workspace/approvals";
import { upsertUserConnection } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { exchangeCode, MicrosoftAuthError, readIdTokenClaims } from "@/lib/workspace/microsoft/oauth";
import { consumeWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * Where Microsoft returns an advisor after their own sign-in. Every outcome
 * but a session mismatch lands back on Workspace with a banner code, so a
 * browser navigation never ends on raw JSON.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const params = new URL(req.url).searchParams;
    const stateParam = params.get("state");
    const state = stateParam ? await consumeWorkspaceOauthState(stateParam) : null;
    if (!state || state.kind !== "user_connect" || state.provider !== "microsoft" || !state.codeVerifier) {
      return redirectTo(req, "/workspace?error=connect_failed");
    }

    // Only the advisor who started this sign-in, in the same firm, may finish it.
    const { orgId: firmId, userId } = await auth();
    if (firmId !== state.firmId || userId !== state.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (params.get("error")) return redirectTo(req, "/workspace?error=connect_declined");
    const code = params.get("code");
    if (!code) return redirectTo(req, "/workspace?error=connect_failed");

    // The admin may have disconnected the firm or switched this advisor off
    // while they were at Microsoft.
    const approval = await getFirmApproval(firmId, "microsoft");
    if (!approval) return redirectTo(req, "/workspace?error=firm_not_approved");
    if (!(await hasMemberAccess(firmId, userId, "microsoft"))) {
      return redirectTo(req, "/workspace?error=member_off");
    }

    const tokens = await exchangeCode({ tenantId: approval.tenantId, code, codeVerifier: state.codeVerifier });
    if (!tokens.idToken) throw new MicrosoftAuthError("missing_id_token");
    const claims = readIdTokenClaims(tokens.idToken);
    // The tenant authorize endpoint already refuses other tenants' accounts;
    // this is the check that doesn't depend on Microsoft enforcing that.
    if (claims.tenantId.toLowerCase() !== approval.tenantId.toLowerCase()) {
      return redirectTo(req, "/workspace?error=wrong_tenant");
    }

    const saved = await upsertUserConnection({
      firmId,
      userId,
      provider: "microsoft",
      tenantId: approval.tenantId,
      externalUserId: claims.userObjectId,
      externalEmail: claims.email,
      tokens,
    });
    if (!saved.ok) return redirectTo(req, "/workspace?error=account_in_use");

    await recordAudit({
      action: "workspace.connect",
      resourceType: "workspace_connection",
      resourceId: saved.id,
      firmId,
      actorId: userId,
      metadata: { provider: "microsoft", connectionId: saved.id },
    });
    return redirectTo(req, "/workspace?connected=1");
  } catch (err) {
    // The error's class and, for Microsoft, its short code only. Never
    // `err.message`: a store error's message carries the query parameters
    // (encrypted tokens, the email, the Microsoft user id).
    console.error("Workspace Microsoft sign-in failed:", {
      name: err instanceof Error ? err.name : typeof err,
      ...(err instanceof MicrosoftAuthError ? { code: err.code } : {}),
    });
    return redirectTo(req, "/workspace?error=connect_failed");
  }
}
