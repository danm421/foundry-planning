import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { upsertUserConnection } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { exchangeCode, MicrosoftAuthError, readIdTokenClaims } from "@/lib/workspace/microsoft/oauth";
import { consumeWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo, safeErrorFields } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/**
 * AADSTS65001: the organization requires an admin to consent. AADSTS90094: a
 * permission needs admin consent. Either way the advisor can't approve Foundry
 * themselves, and their IT admin needs the approval link.
 */
const NEEDS_ADMIN = /\bAADSTS(65001|90094)\b/;

/**
 * The banner code for Microsoft's `?error=` answer. The description is read
 * to classify it and never logged: it can echo tenant and user detail.
 */
function errorCode(error: string, description: string | null): string {
  if (error === "consent_required" || NEEDS_ADMIN.test(description ?? "")) return "needs_admin_approval";
  if (error === "access_denied") return "connect_declined";
  return "connect_failed";
}

/**
 * Where Microsoft returns an advisor after their own sign-in. The connection
 * is stored under the organization the sign-in names, whichever it is. Every
 * outcome but a session mismatch lands back on Workspace with a banner code,
 * so a browser navigation never ends on raw JSON.
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
    if (await isImpersonating()) return redirectTo(req, "/workspace?error=impersonating");

    const error = params.get("error");
    if (error) return redirectTo(req, `/workspace?error=${errorCode(error, params.get("error_description"))}`);
    const code = params.get("code");
    if (!code) return redirectTo(req, "/workspace?error=connect_failed");

    const tokens = await exchangeCode({ code, codeVerifier: state.codeVerifier });
    if (!tokens.idToken) throw new MicrosoftAuthError("missing_id_token");
    const claims = readIdTokenClaims(tokens.idToken);

    const saved = await upsertUserConnection({
      firmId,
      userId,
      provider: "microsoft",
      // Lower-cased, so one organization is always stored in one form (as approvals are).
      tenantId: claims.tenantId.toLowerCase(),
      externalUserId: claims.userObjectId,
      externalEmail: claims.email,
      tokens,
    });
    if (!saved.ok) return redirectTo(req, `/workspace?error=${saved.reason}&provider=microsoft`);

    await recordAudit({
      action: "workspace.connect",
      resourceType: "workspace_connection",
      resourceId: saved.id,
      firmId,
      actorId: userId,
      metadata: { provider: "microsoft", connectionId: saved.id },
    });
    return redirectTo(req, "/workspace?connected=microsoft");
  } catch (err) {
    // Never `err.message`: a store error's message carries the query
    // parameters (encrypted tokens, the email, the Microsoft user id).
    console.error("Workspace Microsoft sign-in failed:", safeErrorFields(err));
    return redirectTo(req, "/workspace?error=connect_failed");
  }
}
