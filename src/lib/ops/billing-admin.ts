import { desc, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions, invoices } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import {
  stateFromMeta,
  type OrgMeta,
  type SubscriptionState,
} from "@/lib/billing/subscription-state";
import { recordAudit } from "@/lib/audit";

// Statuses that count as a firm's single live subscription (mirrors the
// reconcile cron + the subscriptions partial-unique index).
const LIVE_SUB_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused"];

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

  const live = subRows.find((s) => LIVE_SUB_STATUSES.includes(s.status));
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
  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt));
  const live = subRows.find((s) => LIVE_SUB_STATUSES.includes(s.status));
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
