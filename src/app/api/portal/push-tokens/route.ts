import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { portalPushTokens } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";

export const dynamic = "force-dynamic";

type PostBody = { expoPushToken?: string; platform?: string; enabled?: boolean };

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
    if (mode !== "client") {
      return NextResponse.json({ error: "Client mode only" }, { status: 403 });
    }
    // Registration is gated; DELETE (unregister) below deliberately is not —
    // turning your own notifications off must work whatever the firm's billing
    // state. NB not resolvePortalWriteContext: that also runs requireEditEnabled,
    // and a view-only portal client still gets notified.
    await requirePortalActiveSubscription(clientId);

    const body = (await req.json().catch(() => ({}))) as PostBody;
    const token = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : undefined;
    if (!token) {
      return NextResponse.json({ error: "expoPushToken required" }, { status: 400 });
    }
    const platform = body.platform === "android" ? "android" : "ios";
    const enabled = body.enabled ?? true;
    const now = new Date();
    await db
      .insert(portalPushTokens)
      .values({ clientId, clerkUserId, expoPushToken: token, platform, enabled, lastSeenAt: now })
      .onConflictDoUpdate({
        target: portalPushTokens.expoPushToken,
        set: { clientId, clerkUserId, platform, enabled, lastSeenAt: now },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    if (mode !== "client") {
      return NextResponse.json({ error: "Client mode only" }, { status: 403 });
    }
    const token = new URL(req.url).searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    await db
      .delete(portalPushTokens)
      .where(and(eq(portalPushTokens.expoPushToken, token), eq(portalPushTokens.clientId, clientId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
