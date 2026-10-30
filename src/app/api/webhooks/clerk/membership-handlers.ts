import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  advisorProfiles,
  clerkEvents,
  clientShares,
  firms,
  notificationPreferences,
  notifications,
  subscriptions,
  tosAcceptances,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { getOrgMemberCount, expectedSeatQuantity } from "@/lib/billing/seat-count";
import { recordAudit } from "@/lib/audit";
import { findOpenImpersonation } from "@/lib/ops/impersonation";
import { sendWelcomeEmail } from "@/lib/onboarding/welcome-email";
import { removeWorkspaceMember } from "@/lib/workspace/connections";
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
  /** Copied by Clerk from the portal invitation (send-portal-invite.ts). */
  public_metadata?: { clientId?: string };
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

/** Undo a claim whose handling failed, so Clerk's retry of the same delivery
 *  runs it again instead of being skipped as a duplicate. */
async function releaseSvixDelivery(svixId: string): Promise<void> {
  await db.delete(clerkEvents).where(eq(clerkEvents.svixId, svixId));
}

/**
 * Absolute seat sync. Sets the firm's Stripe seat quantity to the CURRENT
 * org member count (never +/- delta — deltas drift under duplicate/concurrent
 * webhooks). No-op for founder orgs and firms without a live subscription.
 * A Stripe failure is swallowed (logged + Sentry) so Clerk doesn't retry-storm;
 * the daily reconcile cron then detects + Sentry-pages any seat-quantity drift.
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
    const memberCount = await getOrgMemberCount(cc, firmId);

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
    const quantity = expectedSeatQuantity(memberCount);
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
 * A removed member gets no more of the firm's alert emails: drop their alert
 * preferences in that firm (email opt-ins, digest cadence) and unflag their
 * unsent emails. The in-app rows stay; they can no longer open the inbox.
 */
async function stopAlertEmailsFor(firmId: string, userId: string): Promise<void> {
  await db
    .delete(notificationPreferences)
    .where(and(eq(notificationPreferences.firmId, firmId), eq(notificationPreferences.userId, userId)));
  await db
    .update(notifications)
    .set({ emailPending: false })
    .where(
      and(
        eq(notifications.firmId, firmId),
        eq(notifications.userId, userId),
        eq(notifications.emailPending, true),
        isNull(notifications.emailedAt),
      ),
    );
}

/**
 * A removed member's brand stops being offered and stops resolving: with
 * their branding off, every household, form and deck that named them falls
 * back to the firm brand, and intake mail is signed by whoever sends it.
 * Update, not upsert — a member who never had a brand row needs none; it only
 * flips a brand that is on, and audits that flip.
 */
async function turnOffAdvisorBranding(firmId: string, userId: string): Promise<void> {
  const flipped = await db
    .update(advisorProfiles)
    .set({ brandingEnabled: false, updatedBy: "clerk:webhook", updatedAt: new Date() })
    .where(
      and(
        eq(advisorProfiles.firmId, firmId),
        eq(advisorProfiles.advisorUserId, userId),
        eq(advisorProfiles.brandingEnabled, true),
      ),
    )
    .returning({ id: advisorProfiles.id });
  if (flipped.length > 0) {
    await recordAudit({
      action: "advisor_branding.grant",
      resourceType: "advisor_profile",
      resourceId: userId,
      firmId,
      actorId: "clerk:webhook",
      metadata: { enabled: false, reason: "member_left_firm" },
    });
  }
}

/**
 * A removed member keeps no access through this firm's client shares: every
 * active grant they RECEIVED on its clients is revoked. Grants from other
 * firms are untouched. Only active rows match, so a retry revokes nothing new.
 */
async function revokeSharesReceivedBy(firmId: string, userId: string): Promise<void> {
  const revoked = await db
    .update(clientShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(clientShares.firmId, firmId),
        eq(clientShares.recipientUserId, userId),
        isNull(clientShares.revokedAt),
      ),
    )
    .returning({ id: clientShares.id, clientId: clientShares.clientId, scope: clientShares.scope });
  for (const share of revoked) {
    await recordAudit({
      action: "client_share.revoke",
      resourceType: "client_share",
      resourceId: share.id,
      clientId: share.clientId,
      firmId,
      actorId: "clerk:webhook",
      metadata: { scope: share.scope, reason: "recipient_left_firm" },
    });
  }
}

/**
 * The active grants a removed member ISSUED stay in force (the firm's clients
 * stay shared); they are listed on the member.removed audit row for review.
 */
function listSharesIssuedBy(firmId: string, userId: string) {
  return db
    .select({
      id: clientShares.id,
      scope: clientShares.scope,
      clientId: clientShares.clientId,
      recipientUserId: clientShares.recipientUserId,
      recipientEmail: clientShares.recipientEmail,
    })
    .from(clientShares)
    .where(
      and(
        eq(clientShares.firmId, firmId),
        eq(clientShares.ownerUserId, userId),
        isNull(clientShares.revokedAt),
      ),
    );
}

/**
 * Team changes made in Clerk's own UI reach us only as these webhooks, which
 * never say who made them. If an ops operator was signed in as a member of
 * the firm at the time, name them on the member.* row as a hint; the actor
 * stays clerk:webhook.
 */
async function impersonationHint(firmId: string): Promise<Record<string, unknown>> {
  const open = await findOpenImpersonation(firmId, new Date());
  return open ? { possibleImpersonator: open } : {};
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
    // Every step below is safe to repeat, so a failure releases the claim.
    try {
      const metadata: Record<string, unknown> = { user_id: userId };
      if (t === "organizationMembership.deleted") {
        await stopAlertEmailsFor(firmId, userId);
        await turnOffAdvisorBranding(firmId, userId);
        await revokeSharesReceivedBy(firmId, userId);
        await removeWorkspaceMember(firmId, userId);
        metadata.issued_shares = await listSharesIssuedBy(firmId, userId);
      }
      await syncSeatQuantity(firmId);
      // Pin the first admin as the firm's billing contact if none is set yet.
      // Handles the sales checkout flow, where the buyer's userId only exists
      // after they accept the org:admin invite (self-serve buyers are pinned by
      // checkout-session-completed). Only fills an empty pin — never overwrites.
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
        metadata: { ...metadata, ...(await impersonationHint(firmId)) },
      });
    } catch (err) {
      await releaseSvixDelivery(svixId);
      throw err;
    }
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
        metadata: {
          from: prevRole,
          to: newRole,
          user_id: userId,
          ...(await impersonationHint(firmId)),
        },
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
    // Not a client signing up from a portal invite: the founder's note is for
    // advisors, and a white-labelled firm's clients must not hear from Foundry.
    const email = resolvePrimaryEmail(d);
    const isPortalClient = Boolean(d.public_metadata?.clientId);
    if (email && !isPortalClient) {
      await sendWelcomeEmail({ to: email, firstName: d.first_name ?? null });
    }

    return NextResponse.json({ ok: true, handled: t }, { status: 200 });
  }

  return null;
}
