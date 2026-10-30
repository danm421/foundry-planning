import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { upsertUserConnection } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { isGoogleConfigured } from "@/lib/workspace/google/config";
import {
  exchangeCode,
  GoogleAuthError,
  hasRequiredScopes,
  readIdTokenClaims,
  revokeToken,
} from "@/lib/workspace/google/oauth";
import { isImpersonating } from "@/lib/workspace/impersonation";
import { consumeWorkspaceOauthState } from "@/lib/workspace/oauth-states";
import { redirectTo, safeErrorFields } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** The banner code for Google's `?error=` answer. The description is never read or logged. */
function errorCode(error: string): string {
  // A Google Workspace admin who hasn't allowed Foundry Planning.
  if (error === "admin_policy_enforced") return "google_blocked";
  if (error === "access_denied") return "connect_declined";
  return "connect_failed";
}

/**
 * Where Google returns an advisor after their own sign-in. The connection is
 * keyed on the id_token's `sub`; the email is display-only (Foundry doesn't
 * check `email_verified`, so it never decides which account this is). Every
 * outcome but a session mismatch lands back on Workspace with a banner code,
 * so a browser navigation never ends on raw JSON.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled() || !isGoogleConfigured()) return new Response("Not found", { status: 404 });
  try {
    const params = new URL(req.url).searchParams;
    const stateParam = params.get("state");
    const state = stateParam ? await consumeWorkspaceOauthState(stateParam) : null;
    if (!state || state.kind !== "user_connect" || state.provider !== "google" || !state.codeVerifier) {
      return redirectTo(req, "/workspace?error=connect_failed");
    }

    // Only the advisor who started this sign-in, in the same firm, may finish it.
    const { orgId: firmId, userId } = await auth();
    if (firmId !== state.firmId || userId !== state.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (await isImpersonating()) return redirectTo(req, "/workspace?error=impersonating");

    const error = params.get("error");
    if (error) return redirectTo(req, `/workspace?error=${errorCode(error)}`);
    const code = params.get("code");
    if (!code) return redirectTo(req, "/workspace?error=connect_failed");

    // A failure here after Google issued tokens can't revoke them (they never
    // come back); it falls to the catch below and stores nothing.
    const tokens = await exchangeCode({ code, codeVerifier: state.codeVerifier });
    // Google's consent screen lets the advisor untick a box. Workspace needs
    // both, so a partial grant is withdrawn rather than left unused.
    if (!hasRequiredScopes(tokens.scope)) {
      await revokeToken(tokens.refreshToken);
      return redirectTo(req, "/workspace?error=missing_permissions");
    }
    if (!tokens.idToken) throw new GoogleAuthError("missing_id_token");
    const claims = readIdTokenClaims(tokens.idToken);

    const saved = await upsertUserConnection({
      firmId,
      userId,
      provider: "google",
      // A Google Workspace address's domain goes where Microsoft's tenant goes; a Gmail has none.
      tenantId: claims.hostedDomain ?? "",
      externalUserId: claims.subject,
      externalEmail: claims.email,
      tokens,
    });
    if (!saved.ok) return redirectTo(req, `/workspace?error=${saved.reason}&provider=google`);

    await recordAudit({
      action: "workspace.connect",
      resourceType: "workspace_connection",
      resourceId: saved.id,
      firmId,
      actorId: userId,
      metadata: { provider: "google", connectionId: saved.id },
    });
    return redirectTo(req, "/workspace?connected=google");
  } catch (err) {
    // Never `err.message`: a store error's message carries the query
    // parameters (encrypted tokens, the email, the Google user id).
    console.error("Workspace Google sign-in failed:", safeErrorFields(err));
    return redirectTo(req, "/workspace?error=connect_failed");
  }
}
