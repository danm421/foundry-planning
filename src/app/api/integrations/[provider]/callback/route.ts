import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { consumeOauthState, upsertConnection } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { resolveProvider } from "../_provider";

const SETTINGS_PATH = "/settings/integrations";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const provider = await resolveProvider(params);
  if (!provider) return new Response("Not found", { status: 404 });

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

  // Cross-provider confusion guard: a state minted for one provider must not be
  // completable at another provider's callback.
  if (stateRow.providerId !== provider.id) {
    return NextResponse.json({ error: "Provider mismatch" }, { status: 400 });
  }

  // Existing guard, unchanged: the session firm must match the state's firm.
  const { orgId, userId } = await auth();
  if (!orgId || orgId !== stateRow.firmId) {
    return NextResponse.json({ error: "Firm mismatch" }, { status: 403 });
  }

  try {
    const tokens = await provider.oauth.exchangeCodeForTokens({ code, codeVerifier: stateRow.codeVerifier });
    await upsertConnection({
      firmId: stateRow.firmId,
      providerId: provider.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null,
      scope: tokens.scope,
      userId: userId ?? stateRow.userId,
    });
    await recordAudit({
      action: "integration.connect",
      resourceType: "integration_connection",
      resourceId: stateRow.firmId,
      firmId: stateRow.firmId,
      metadata: { provider: provider.id },
    });
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?connected=${provider.id}`, req.url));
  } catch (err) {
    console.error(
      `GET /api/integrations/${provider.id}/callback exchange failed:`,
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.redirect(new URL(`${SETTINGS_PATH}?error=${provider.id}_exchange_failed`, req.url));
  }
}
