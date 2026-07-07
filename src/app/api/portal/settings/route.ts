// src/app/api/portal/settings/route.ts
//
// Portal privacy settings. GET is act-as aware (the advisor preview shows the
// client's choices read-only); PUT is client-only — sharing is the client's
// decision, so an advisor in act-as preview may not flip it. Deliberately NOT
// gated on requireEditEnabled: privacy stays client-controlled even when the
// advisor has made the portal read-only.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portalPrivacySettings, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { loadPortalPrivacy, type PortalPrivacy } from "@/lib/portal/privacy";
import { recordUpdate } from "@/lib/audit/record-helpers";
import type { FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

const FIELD_LABELS: FieldLabels = {
  shareTransactions: { label: "Share transactions", format: "text" },
  shareBudgets: { label: "Share budget", format: "text" },
  shareRecurrings: { label: "Share recurrings", format: "text" },
};

export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    const privacy = await loadPortalPrivacy(clientId);
    return NextResponse.json({ privacy, mode });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

type Body = Partial<Record<keyof PortalPrivacy, unknown>>;
const KEYS = ["shareTransactions", "shareBudgets", "shareRecurrings"] as const;

export async function PUT(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    if (mode !== "client") {
      return NextResponse.json(
        { error: "Only the client can change what they share" },
        { status: 403 },
      );
    }
    await requirePortalActiveSubscription(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    const patch: Partial<PortalPrivacy> = {};
    for (const key of KEYS) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
        }
        patch[key] = body[key] as boolean;
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const [{ firmId } = { firmId: null as string | null }] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!firmId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const before = await loadPortalPrivacy(clientId);
    const next: PortalPrivacy = { ...before, ...patch };

    await db
      .insert(portalPrivacySettings)
      .values({ clientId, ...next })
      .onConflictDoUpdate({
        target: portalPrivacySettings.clientId,
        set: { ...patch, updatedAt: new Date() },
      });

    await recordUpdate({
      action: "portal.privacy.update",
      resourceType: "portal_privacy_settings",
      resourceId: clientId,
      clientId,
      firmId,
      actorKind: "client",
      before: { ...before },
      after: { ...next },
      fieldLabels: FIELD_LABELS,
    });

    return NextResponse.json({ ok: true, privacy: next });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
