import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  firms,
  subscriptions,
  subscriptionItems,
  tosAcceptances,
} from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { deriveEntitlements } from "@/lib/billing/entitlements";
import { getActiveEntitlementOverrides } from "@/lib/ops/entitlements";
import { readSubscriptionItemMeta } from "@/lib/billing/subscription-item-meta";
import {
  readPendingSignup,
  clearPendingSignup,
} from "@/lib/billing/pending-signup";
import { recordAudit } from "@/lib/audit";

const TOS_VERSION_DEFAULT = "v1";

/**
 * checkout.session.completed — the entry point for new firms. It serves two
 * populations, told apart by `client_reference_id`:
 *
 *   PROFILE-FIRST (self-serve, /welcome). The buyer already has a Clerk account
 *   and already told us their firm name and branding. We create the org with
 *   `createdBy`, put them in it directly, and send NO invitation. They are
 *   handed into the workspace by /checkout/success.
 *
 *   SALES (docs/founding-pricing-runbook.md). The session was hand-built in the
 *   Stripe CLI for a buyer with no account. The firm name comes from Stripe's
 *   custom field and we email an org:admin invitation, exactly as before. Six of
 *   seven real firms were closed this way; do not break it.
 *
 * Order of ops (unchanged, and load-bearing): the firms row must be committed
 * before customer-subscription-upserted.ts can resolve metadata.firm_id — that
 * handler returns early and logs "firm <id> not in DB yet" otherwise. The Clerk
 * org metadata is stamped LAST, which is why /api/checkout/status waits on it
 * rather than on the DB row (see that route).
 *
 * On the sales path the Clerk org invitation triggers the existing Clerk webhook
 * chain; the user.created webhook then writes the second tos_acceptances row
 * with acceptance_source: clerk_signup.
 */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(
    (event.data.object as { id: string }).id,
    { expand: ["customer_details", "custom_fields", "consent"] },
  );

  const firmName =
    session.custom_fields?.find((f) => f.key === "firm_name")?.text?.value ??
    "Unnamed Firm";
  const buyerEmail = session.customer_details?.email;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!buyerEmail || !customerId || !subId) {
    throw new Error(
      `checkout session ${session.id} missing buyer email, customer, or subscription`,
    );
  }

  // Present only on the self-serve path — this is the whole switch.
  const buyerUserId = session.client_reference_id ?? null;
  const profile = buyerUserId ? await readPendingSignup(buyerUserId) : null;

  // Our own form wins over the Stripe custom field: it is validated, fixable,
  // and on the self-serve path Stripe no longer collects a name at all.
  const resolvedFirmName = profile?.firmName?.trim() || firmName;

  const cc = await clerkClient();

  // 1. Idempotency: a redelivery after a partial failure must converge on the
  //    original firm, not mint a second Clerk org. Look up any subscription we
  //    already recorded for this Stripe customer; reuse its firmId if present.
  const existingSub = await db
    .select({ firmId: subscriptions.firmId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .then((r) => r[0]);

  let firmId: string;
  if (existingSub?.firmId) {
    firmId = existingSub.firmId;
  } else {
    const org = await cc.organizations.createOrganization(
      buyerUserId
        ? { name: resolvedFirmName, createdBy: buyerUserId }
        : { name: resolvedFirmName },
    );
    firmId = org.id;
  }

  // 2. Stamp Stripe subscription with the firm_id so future webhooks resolve.
  await stripe.subscriptions.update(subId, {
    metadata: { firm_id: firmId },
  });

  // 3. Re-fetch the now-stamped subscription for full state.
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ["items.data.price"],
  });

  // 4. Get the buyer into the org.
  if (buyerUserId) {
    // `createdBy` already put them in the org. This ensure covers the one path
    // that could leave them out — a redelivery that reused an existing firm
    // whose membership never landed. Clerk throws when they are already a
    // member, which is the normal case, so the throw is expected and ignored.
    try {
      await cc.organizations.createOrganizationMembership({
        organizationId: firmId,
        userId: buyerUserId,
        role: "org:admin",
      });
    } catch {
      /* already a member — the role is pinned below regardless */
    }
    // Pin the role. `createdBy` grants the instance's configured creatorRole,
    // which on our Clerk instance is org:owner — a role authz.ts retired, and
    // one requireOrgAdminOrOwner() rejects, so a buyer left at org:owner is
    // 403'd on firm config, team invites and CMA edits: the first surfaces a
    // new admin touches. The ensure above cannot fix it (they are already a
    // member, so it throws). Same call applyFounderState uses; idempotent, and
    // correct under either creatorRole setting. Best-effort — a Clerk hiccup
    // must not fail an otherwise-successful provision.
    try {
      await cc.organizations.updateOrganizationMembership({
        organizationId: firmId,
        userId: buyerUserId,
        role: "org:admin",
      });
    } catch (err) {
      // Deliberately NOT re-thrown: the provision itself succeeded, and turning
      // a non-fatal condition into a non-200 would put this whole handler into
      // repeated Stripe redelivery. But a log line alone would strand a paying
      // buyer at org:owner — 403'd on firm config and team invites — with no
      // trace outside the logs, so the condition is recorded where this app
      // already looks. recordAudit swallows its own failures (audit.ts), so it
      // cannot itself break the provision.
      console.error(
        "[checkout.session.completed] pinning buyer to org:admin failed:",
        err,
      );
      await recordAudit({
        action: "billing.org_role_pin_failed",
        resourceType: "firm",
        resourceId: firmId,
        firmId,
        actorId: `stripe:webhook:${event.id}`,
        metadata: {
          buyer_user_id: buyerUserId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  } else {
    // Sales path: no Clerk user exists yet, so the invitation is the only way in.
    await cc.organizations.createOrganizationInvitation({
      organizationId: firmId,
      emailAddress: buyerEmail,
      role: "org:admin",
    });
  }

  // Stripe API v22 moved current_period_* off Subscription onto each
  // SubscriptionItem to support multi-period subscriptions. For our
  // single-product subs the first item's period is authoritative.
  const firstItem = sub.items.data[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number | null;
        current_period_end?: number | null;
      })
    | undefined;
  const periodStart = firstItem?.current_period_start ?? null;
  const periodEnd = firstItem?.current_period_end ?? null;

  // 5. Insert DB rows.
  await db
    .insert(firms)
    .values({
      firmId,
      displayName: resolvedFirmName,
      isFounder: false,
      // Branding the buyer chose at /welcome. Null on the sales path and
      // whenever they skipped it — the app falls back to the Foundry marks.
      // Written in the INSERT rather than a follow-up UPDATE so a redelivery
      // (onConflictDoNothing) cannot clobber a firm that has since rebranded.
      logoUrl: profile?.logoUrl ?? null,
      primaryColor: profile?.primaryColor ?? null,
    })
    .onConflictDoNothing()
    .returning({ firmId: firms.firmId });

  const subRows = await db
    .insert(subscriptions)
    .values({
      firmId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      status: sub.status,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    })
    .onConflictDoNothing()
    .returning({ id: subscriptions.id });

  const internalSubId = subRows[0]?.id;
  if (internalSubId && sub.items.data.length > 0) {
    await db
      .insert(subscriptionItems)
      .values(
        sub.items.data.map((it) => {
          const price = typeof it.price === "object" && it.price ? it.price : null;
          return {
            subscriptionId: internalSubId,
            firmId,
            stripeItemId: it.id,
            stripePriceId: price?.id ?? "",
            ...readSubscriptionItemMeta(it),
            quantity: it.quantity ?? 1,
            unitAmount: price?.unit_amount ?? 0,
            currency: price?.currency ?? "usd",
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: subscriptionItems.id });
  }

  // 6. ToS acceptance record. We don't use Stripe's consent_collection
  // (see note in checkout.ts) — completing Checkout is itself the acceptance,
  // and we record it unconditionally. The Clerk user.created webhook will
  // later write a second row with acceptance_source="clerk_signup".
  await db
    .insert(tosAcceptances)
    .values({
      // On the self-serve path we know exactly who accepted. The
      // `stripe:<customerId>` placeholder exists only because the sales path
      // has no Clerk user at this point.
      userId: buyerUserId ?? `stripe:${customerId}`,
      firmId,
      tosVersion: TOS_VERSION_DEFAULT,
      acceptanceSource: "stripe_checkout",
    })
    .onConflictDoNothing()
    .returning({ id: tosAcceptances.id });

  // 7. Set Clerk metadata. At checkout the line items aren't materialized in
  // this handler, so we derive from an empty item set — any pre-existing grant
  // override surfaces immediately; the subsequent customer.subscription.created
  // webhook recomputes entitlements with the real items + overrides.
  const overrides = await getActiveEntitlementOverrides(firmId);
  const entitlements = deriveEntitlements({ items: [], overrides });
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      entitlements,
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
    },
  });

  // 8. Audit.
  await recordAudit({
    action: "billing.subscription_created",
    resourceType: "subscription",
    resourceId: sub.id,
    firmId,
    actorId: `stripe:webhook:${event.id}`,
    metadata: {
      buyer_email: buyerEmail,
      firm_name: resolvedFirmName,
      checkout_session_id: session.id,
    },
  });

  // 9. The firm exists — the stash has done its job. Best-effort: a failure
  // here must not fail an otherwise-successful provision, and /welcome
  // redirects anyone who already has an org anyway.
  if (buyerUserId) {
    try {
      await clearPendingSignup(buyerUserId);
    } catch (err) {
      console.error("[checkout.session.completed] stash clear failed:", err);
    }
  }
}
