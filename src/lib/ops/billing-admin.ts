import { desc, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions, invoices, firms } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import {
  stateFromMeta,
  COMP_ENDED_STATUS,
  type OrgMeta,
  type SubscriptionState,
} from "@/lib/billing/subscription-state";
import { applyFounderState } from "@/lib/billing/founder-init";
import { readEntitlementsFromMeta } from "@/lib/billing/entitlements";
import { resolveBillingContactUserId } from "@/lib/billing/billing-contact";
import { recordAudit } from "@/lib/audit";

// Statuses that count as a firm's single live subscription (mirrors the
// reconcile cron + the subscriptions partial-unique index).
const LIVE_SUB_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused"];

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** Pure: the firm's single live subscription from its rows, or null. */
function pickLiveSubscription(rows: SubscriptionRow[]): SubscriptionRow | null {
  return rows.find((s) => LIVE_SUB_STATUSES.includes(s.status)) ?? null;
}

/** The firm's single live subscription. Null when every row is dead. */
async function loadLiveSubscription(firmId: string): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt));
  return pickLiveSubscription(rows);
}

/** True when the configured Stripe key is a live-mode key. */
export function isStripeLiveMode(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ?? false;
}

/** Pure: the Stripe dashboard deep link for a customer (test vs live path). */
export function stripeDashboardCustomerUrl(stripeCustomerId: string, livemode: boolean): string {
  const segment = livemode ? "" : "test/";
  return `https://dashboard.stripe.com/${segment}customers/${stripeCustomerId}`;
}

/** Pure: extend a trial to `days` past the later of the current end or `now`. */
export function computeExtendedTrialEnd(
  currentTrialEnd: Date | null,
  days: number,
  now: Date,
): Date {
  const base = currentTrialEnd && currentTrialEnd > now ? currentTrialEnd : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export type FirmInvoice = {
  stripeInvoiceId: string;
  status: string | null;
  amountDue: number | null;
  amountPaid: number | null;
  currency: string | null;
  periodEnd: Date | null;
  hostedInvoiceUrl: string | null;
};

export type FirmSubscriptionSummary = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type FirmBilling = {
  state: SubscriptionState;
  subscription: FirmSubscriptionSummary | null;
  invoices: FirmInvoice[];
  stripeCustomerId: string | null;
  dashboardUrl: string | null;
  canExtendTrial: boolean;
};

/** Read-only billing view for the target firm (DB rows + Clerk-derived state). */
export async function loadFirmBilling(firmId: string): Promise<FirmBilling> {
  const [subRows, invoiceRows, cc] = await Promise.all([
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.firmId, firmId))
      .orderBy(desc(subscriptions.createdAt)),
    db
      .select()
      .from(invoices)
      .where(eq(invoices.firmId, firmId))
      .orderBy(desc(invoices.createdAt))
      .limit(10),
    clerkClient(),
  ]);

  // Enforcement-truth state from the target org's Clerk metadata (same pure
  // mapping the advisor app + middleware use).
  let state: SubscriptionState = { kind: "missing", reason: "no_metadata" };
  try {
    const org = await cc.organizations.getOrganization({ organizationId: firmId });
    state = stateFromMeta(org.publicMetadata as OrgMeta);
  } catch {
    // org may not exist in Clerk (rare race / hard-deleted) — leave "missing".
  }

  const live = pickLiveSubscription(subRows);
  const summarySource = live ?? subRows[0] ?? null;
  const subscription: FirmSubscriptionSummary | null = summarySource
    ? {
        stripeSubscriptionId: summarySource.stripeSubscriptionId,
        stripeCustomerId: summarySource.stripeCustomerId,
        status: summarySource.status,
        trialEnd: summarySource.trialEnd,
        currentPeriodEnd: summarySource.currentPeriodEnd,
        cancelAtPeriodEnd: summarySource.cancelAtPeriodEnd,
      }
    : null;

  const stripeCustomerId = summarySource?.stripeCustomerId ?? null;

  return {
    state,
    subscription,
    invoices: invoiceRows.map((r) => ({
      stripeInvoiceId: r.stripeInvoiceId,
      status: r.status,
      amountDue: r.amountDue,
      amountPaid: r.amountPaid,
      currency: r.currency,
      periodEnd: r.periodEnd,
      hostedInvoiceUrl: r.hostedInvoiceUrl,
    })),
    stripeCustomerId,
    dashboardUrl: stripeCustomerId
      ? stripeDashboardCustomerUrl(stripeCustomerId, isStripeLiveMode())
      : null,
    canExtendTrial: live?.status === "trialing",
  };
}

/** Create a Stripe billing-portal session for the target firm. Audited. */
export async function createPortalSessionForFirm(args: {
  firmId: string;
  returnUrl: string;
  setBy: string; // ops clerk_user_id
}): Promise<string> {
  const { firmId, returnUrl, setBy } = args;
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  const customer = row?.stripeCustomerId;
  if (!customer) throw new Error("This org has no Stripe customer to manage.");

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: returnUrl,
  });
  await recordAudit({
    action: "ops.billing.portal_opened",
    resourceType: "subscription",
    resourceId: customer,
    firmId,
    actorId: setBy,
  });
  return session.url;
}

/**
 * Comp a firm onto the Founder plan: full access, no subscription, never billed.
 *
 * Order matters and is the whole point of this function existing:
 *
 *  1. `applyFounderState` writes the Clerk metadata AND flips `firms.is_founder`.
 *     Clerk first means the firm is already a founder in the enforcement path
 *     before its subscription disappears, so access never dips.
 *  2. Only then is the Stripe subscription canceled. The resulting
 *     `customer.subscription.deleted` webhook reads the flag set in step 1 and
 *     therefore skips archiving the firm — which is what keeps the purge cron
 *     away from a comped customer's data.
 *
 * Doing these in the other order leaves a window where the firm reads as
 * `canceled_grace` (mutations blocked) and gets an archive stamp nothing
 * clears. That window is why this is a button and not a runbook.
 *
 * Reversible: `endFounderComp` below takes a firm back off the plan and
 * prompts it through checkout.
 */
export async function compFirmToFounder(args: {
  firmId: string;
  reason: string;
  setBy: string; // ops clerk_user_id
}): Promise<{ canceledSubscriptionId: string | null }> {
  const { firmId, reason, setBy } = args;
  if (!reason.trim()) throw new Error("A reason is required to comp a firm to founder.");

  const cc = await clerkClient();
  // Independent reads — the org isn't needed to resolve the owner.
  const [org, ownerUserId] = await Promise.all([
    cc.organizations.getOrganization({ organizationId: firmId }),
    // The billing contact is the firm's owner-of-record, resolved through the
    // same lockout-safe chain the customer-facing billing page uses.
    resolveBillingContactUserId(firmId),
  ]);
  if (!ownerUserId) {
    throw new Error(`Org ${firmId} has no members — cannot resolve an owner to comp.`);
  }

  // Carry forward whatever entitlements the org already holds. `client_portal`
  // isn't in the base set and isn't implied by any Stripe price, so deriving
  // from scratch would silently strip it from a firm that had been granted it.
  const existingEntitlements = readEntitlementsFromMeta(org.publicMetadata);

  await applyFounderState({
    firmId,
    displayName: org.name,
    ownerUserId,
    entitlements: existingEntitlements,
  });

  // Lift any cancellation archive the firm is already carrying. Comping a firm
  // that CHURNED is the case that needs this: it has no live subscription, so
  // nothing below cancels, so the webhook that would have spared it never runs
  // — and its 90-day deletion clock would keep ticking under founder status.
  // Same fields reactivation clears (see customer-subscription-upserted).
  await db
    .update(firms)
    .set({ archivedAt: null, dataRetentionUntil: null, updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));

  // Cancel whatever live subscription exists. A firm comped before it ever
  // subscribed simply has none — that's not an error.
  const live = await loadLiveSubscription(firmId);

  if (live) {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(live.stripeSubscriptionId, {
      prorate: false,
    });
  }

  await recordAudit({
    action: "ops.billing.comped_to_founder",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: setBy,
    metadata: {
      reason,
      ownerUserId,
      canceledSubscriptionId: live?.stripeSubscriptionId ?? null,
      previousStatus: live?.status ?? null,
      entitlements: existingEntitlements,
    },
  });

  return { canceledSubscriptionId: live?.stripeSubscriptionId ?? null };
}

/**
 * End a firm's Founder comp: they stop being comped and are prompted through
 * checkout the next time they use the app.
 *
 * Deliberately NOT a bare "clear the flag". Clearing is_founder alone leaves
 * the firm reading as `missing` — an unprovisioned/broken account, which
 * `decideAccess` locks out of READS as well, and which /settings/billing
 * answers with "contact support". That is a lockout with a dead end, not a
 * prompt. So this writes a distinguishable `comp_ended` status instead, which:
 *
 *   - decides to `block_mutation`, not `lock_out` — they keep reading their
 *     own book while they decide, the same deal a firm gets when its card
 *     lapses (anything harsher would punish a de-comped firm MORE than one
 *     that simply stopped paying);
 *   - renders a persistent "Subscribe" banner and a real checkout button on
 *     /settings/billing, bound to THIS org (see `existingFirmId` in
 *     checkout.ts — the binding is what stops checkout minting a second org
 *     and stranding their clients);
 *   - stays legible in the ops console and the audit trail, where `missing`
 *     would be indistinguishable from a provisioning bug.
 *
 * Both flags are cleared because both are read: `stateFromMeta` reads Clerk's
 * is_founder ahead of any subscription status, while the purge cron and the
 * ops console read `firms.is_founder`.
 *
 * The firm is NOT archived and gets no retention deadline — `isFirmPurgeable`
 * demands an archive stamp, so their data stays untouchable by the purge cron
 * for as long as they take to decide.
 */
export async function endFounderComp(args: {
  firmId: string;
  reason: string;
  setBy: string; // ops clerk_user_id
}): Promise<void> {
  const { firmId, reason, setBy } = args;
  if (!reason.trim()) throw new Error("A reason is required to end a firm's comp.");

  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: firmId });
  const meta = (org.publicMetadata ?? {}) as Record<string, unknown>;
  if (meta.is_founder !== true) {
    throw new Error(`Org ${firmId} is not on the Founder plan — there is no comp to end.`);
  }

  // Carry entitlements forward untouched: read-only access still has to render
  // the surfaces they hold (client_portal isn't in the base set and no Stripe
  // price implies it, so re-deriving would strip it). A real checkout
  // recomputes them from the subscription items anyway.
  const entitlements = readEntitlementsFromMeta(meta);

  // DB first, Clerk last. Clerk is enforcement truth, so it is the committing
  // step; the half-done state the other order would leave (app restricts them
  // while ops tooling still reads "founder") is the more confusing one. Either
  // way the firm is never purgeable, because nothing here sets an archive
  // stamp.
  await db
    .update(firms)
    .set({ isFounder: false, updatedAt: new Date() })
    .where(eq(firms.firmId, firmId));

  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: {
      ...meta,
      is_founder: false,
      subscription_status: COMP_ENDED_STATUS,
      entitlements,
    },
  });

  await recordAudit({
    action: "ops.billing.comp_ended",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: setBy,
    metadata: { reason, entitlements },
  });
}

/** Extend the target firm's trial via Stripe. Webhooks sync DB + Clerk. Audited. */
export async function extendTrialForFirm(args: {
  firmId: string;
  days: number;
  reason: string;
  setBy: string; // ops clerk_user_id
}): Promise<Date> {
  const { firmId, days, reason, setBy } = args;
  if (!Number.isInteger(days) || days <= 0 || days > 90) {
    throw new Error("Trial extension must be 1–90 days.");
  }
  const live = await loadLiveSubscription(firmId);
  if (!live) throw new Error("This org has no live subscription.");
  if (live.status !== "trialing") {
    throw new Error("Trial can only be extended while the subscription is trialing.");
  }

  const newTrialEnd = computeExtendedTrialEnd(live.trialEnd, days, new Date());
  const stripe = getStripe();
  // Stripe is the source of truth: the customer.subscription.updated webhook
  // syncs the local subscriptions row + Clerk metadata. We never write locally.
  await stripe.subscriptions.update(live.stripeSubscriptionId, {
    trial_end: Math.floor(newTrialEnd.getTime() / 1000),
    proration_behavior: "none",
  });
  await recordAudit({
    action: "ops.billing.trial_extended",
    resourceType: "subscription",
    resourceId: live.stripeSubscriptionId,
    firmId,
    actorId: setBy,
    metadata: {
      days,
      reason,
      previousTrialEnd: live.trialEnd?.toISOString() ?? null,
      newTrialEnd: newTrialEnd.toISOString(),
    },
  });
  return newTrialEnd;
}
