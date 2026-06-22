import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clerkEvents,
  firms,
  subscriptions,
  tosAcceptances,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";
import { sendWelcomeEmail } from "@/lib/onboarding/welcome-email";
import type { ClerkEvent } from "./handler";

type MembershipEventData = {
  organization?: { id?: string };
  public_user_data?: { user_id?: string };
  previous_attributes?: { role?: string };
  role?: string;
};

type UserCreatedData = {
  id?: string;
  first_name?: string | null;
  email_addresses?: Array<{ id?: string; email_address?: string }>;
  primary_email_address_id?: string | null;
  legal_consent?: { tos_accepted_at?: string; tos_version?: string };
};

/**
 * Record this svix delivery; returns true if it's NEW (process it) or false
 * if a row already exists (duplicate — skip). The UNIQUE(svix_id) constraint
 * + ON CONFLICT DO NOTHING makes this the idempotency gate.
 */
async function claimSvixDelivery(
  svixId: string,
  eventType: string,
): Promise<boolean> {
  const rows = await db
    .insert(clerkEvents)
    .values({ svixId, eventType, result: null })
    .onConflictDoNothing()
    .returning({ id: clerkEvents.id });
  return rows.length > 0;
}

/**
 * Absolute seat sync. Sets the firm's Stripe seat quantity to the CURRENT
 * org member count (never +/- delta — deltas drift under duplicate/concurrent
 * webhooks). No-op for founder orgs and firms without a live subscription.
 * A Stripe failure is swallowed (logged + Sentry) so Clerk doesn't retry-storm;
 * the daily reconcile cron self-heals the quantity.
 */
async function syncSeatQuantity(firmId: string): Promise<void> {
  const firmRows = await db.select().from(firms).where(eq(firms.firmId, firmId));
  const firm = firmRows[0];
  if (!firm || firm.isFounder) return;

  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId));
  const sub = subRows.find((s) =>
    ["trialing", "active", "past_due", "unpaid"].includes(s.status),
  );
  if (!sub) return;

  try {
    const cc = await clerkClient();
    const members = await cc.organizations.getOrganizationMembershipList({
      organizationId: firmId,
      limit: 100,
    });
    const memberCount =
      (members as { total_count?: number }).total_count ?? members.data.length;

    const stripe = getStripe();
    const liveSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
      expand: ["items.data.price"],
    });
    const seat = liveSub.items.data.find(
      (it) =>
        ((it.metadata as Record<string, string | undefined>).kind ?? "seat") !==
        "addon",
    );
    if (!seat) return;
    const quantity = Math.max(1, memberCount);
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: seat.id, quantity }],
      proration_behavior: "create_prorations",
    });
  } catch (err) {
    // Best-effort: Clerk membership is already correct; the seat count is the
    // only thing out of sync, and the reconcile cron heals it. Returning lets
    // the route reply 200 so Clerk doesn't hammer retries.
    console.error(
      `[webhook.clerk] seat sync failed for firm ${firmId}:`,
      err instanceof Error ? err.message : err,
    );
    Sentry.captureException(err, { extra: { firmId, where: "syncSeatQuantity" } });
  }
}

/**
 * Resolve the user's primary email from a Clerk user.created payload. Prefers
 * the address flagged primary_email_address_id; falls back to the first entry.
 * Returns null when no usable address is present.
 */
function resolvePrimaryEmail(d: UserCreatedData): string | null {
  const list = d.email_addresses ?? [];
  if (list.length === 0) return null;
  const primary = d.primary_email_address_id
    ? list.find((e) => e.id === d.primary_email_address_id)
    : undefined;
  return primary?.email_address ?? list[0]?.email_address ?? null;
}

export async function dispatchClerkMembership(
  evt: ClerkEvent,
  svixId: string,
): Promise<Response | null> {
  const t = evt.type;

  if (t === "organizationMembership.created" || t === "organizationMembership.deleted") {
    const d = evt.data as MembershipEventData;
    const firmId = d.organization?.id;
    const userId = d.public_user_data?.user_id;
    if (!firmId || !userId) {
      return NextResponse.json({ error: "missing IDs" }, { status: 400 });
    }
    // svix-id dedupe: a duplicate delivery must not re-issue the Stripe update.
    const isNew = await claimSvixDelivery(svixId, t);
    if (!isNew) {
      return NextResponse.json({ ok: true, skipped_duplicate: t }, { status: 200 });
    }
    await syncSeatQuantity(firmId);
    // Pin the first admin as the firm's billing contact if none is set yet.
    // Handles the checkout flow, where the buyer's userId only exists after
    // they accept the org:admin invite. Idempotent — only writes when unset.
    if (t === "organizationMembership.created" && d.role === "org:admin") {
      const cc = await clerkClient();
      const org = await cc.organizations.getOrganization({ organizationId: firmId });
      const meta = (org.publicMetadata ?? {}) as Record<string, unknown>;
      if (typeof meta.billing_contact_userId !== "string") {
        await cc.organizations.updateOrganizationMetadata(firmId, {
          publicMetadata: { ...meta, billing_contact_userId: userId },
        });
      }
    }
    await recordAudit({
      action: t === "organizationMembership.created" ? "member.invited" : "member.removed",
      resourceType: "membership",
      resourceId: `${firmId}:${userId}`,
      firmId,
      actorId: "clerk:webhook",
      metadata: { user_id: userId },
    });
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  if (t === "organizationMembership.updated") {
    const d = evt.data as MembershipEventData;
    const firmId = d.organization?.id;
    const userId = d.public_user_data?.user_id;
    if (!firmId || !userId) {
      return NextResponse.json({ error: "missing IDs" }, { status: 400 });
    }
    const prevRole = d.previous_attributes?.role;
    const newRole = d.role;
    if (prevRole && newRole && prevRole !== newRole) {
      await recordAudit({
        action: "member.role_changed",
        resourceType: "membership",
        resourceId: `${firmId}:${userId}`,
        firmId,
        actorId: "clerk:webhook",
        metadata: { from: prevRole, to: newRole, user_id: userId },
      });
    }
    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  if (t === "user.created") {
    const d = evt.data as UserCreatedData;
    const userIdNew = d.id;

    // svix-id dedupe: a duplicate delivery must not re-send the welcome email.
    const isNew = await claimSvixDelivery(svixId, t);
    if (!isNew) {
      return NextResponse.json({ ok: true, skipped_duplicate: t }, { status: 200 });
    }

    // Record ToS acceptance captured at Clerk signup (unchanged behavior).
    const consent = d.legal_consent;
    if (userIdNew && consent?.tos_accepted_at) {
      await db
        .insert(tosAcceptances)
        .values({
          userId: userIdNew,
          firmId: null,
          tosVersion: consent.tos_version ?? "v1",
          acceptanceSource: "clerk_signup",
        })
        .onConflictDoNothing()
        .returning({ id: tosAcceptances.id });
    }

    // Welcome the new user. Best-effort — sendWelcomeEmail never throws.
    const email = resolvePrimaryEmail(d);
    if (email) {
      await sendWelcomeEmail({ to: email, firstName: d.first_name ?? null });
    }

    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  return null;
}
