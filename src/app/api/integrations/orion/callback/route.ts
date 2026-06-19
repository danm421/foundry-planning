import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { consumeOauthState, upsertConnection } from "@/lib/orion/connections";
import { exchangeCodeForTokens } from "@/lib/orion/oauth";
import { recordAudit } from "@/lib/audit";

const SETTINGS_PATH = "/settings/integrations";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
  }

  const stateRow = await consumeOauthState(state);
  if (!stateRow) {
    return NextResponse.json({ error: "Invalid or expired state" }, { status: 400 });
  }

  const { orgId, userId } = await auth();
  if (!orgId || orgId !== stateRow.firmId) {
    return NextResponse.json({ error: "Firm mismatch" }, { status: 403 });
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, codeVerifier: stateRow.codeVerifier });
    await upsertConnection({
      firmId: stateRow.firmId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null,
      scope: tokens.scope,
      userId: userId ?? stateRow.userId,
    });
    await recordAudit({
      action: "orion_integration.connect",
      resourceType: "orion_connection",
      resourceId: stateRow.firmId,
      firmId: stateRow.firmId,
    });
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?connected=orion`, req.url));
  } catch (err) {
    console.error("GET /api/integrations/orion/callback exchange failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?error=orion_exchange_failed`, req.url));
  }
}
