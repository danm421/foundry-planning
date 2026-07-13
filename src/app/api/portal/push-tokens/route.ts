import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { portalPushTokens } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";

export const dynamic = "force-dynamic";

type PostBody = { expoPushToken?: string; platform?: string; enabled?: boolean };

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
    if (mode !== "client") {
      return NextResponse.json({ error: "Client mode only" }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const token = body.expoPushToken?.trim();
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
