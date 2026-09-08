// src/lib/billing/trial-feedback.ts
//
// The founder's "why did you cancel?" note, sent about a day after an advisor
// cancels a trial that still had time left on it.
//
// Pick the candidates, write the note, send it — one file, the way
// lib/feedback/email.ts keeps its build and send together. Splitting three
// short functions across three modules buys nothing here.
import { and, eq, gte, inArray, isNotNull, lt, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Resend } from "resend";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { auditLog, firms, subscriptions } from "@/db/schema";
import { resolveBillingContact } from "@/lib/billing/billing-contact";
import { FOUNDER_FROM, FOUNDER_REPLY_TO } from "@/lib/email/founder";

const HOUR_MS = 60 * 60 * 1000;

/** How long to wait after the cancellation before writing. */
const DELAY_MS = 24 * HOUR_MS;

/**
 * How far back a single run will reach. The job runs hourly, so this ceiling
 * only matters when runs are missed — a skipped hour is picked up by the next
 * one instead of being lost. It is NOT what prevents a second send; the audit
 * check in `dropAlreadySent` is.
 */
const LOOKBACK_MS = 48 * HOUR_MS;

/**
 * Kill-switch. Mirrors the flag pattern Foundry already uses
 * (src/domain/forge/flag.ts, src/lib/integrations/providers/addepar/flag.ts):
 * strict equality on "true", so a stray "1"/"yes"/"" never silently starts
 * mailing customers. OFF until the copy has been signed off.
 *
 * When false the job still selects and reports its recipients — that dry run
 * is how you see who a real run would write to before it writes to them.
 */
export function isTrialFeedbackEnabled(): boolean {
  return process.env.TRIAL_FEEDBACK_EMAIL_ENABLED === "true";
}

/** Audit action stamped once the note is actually delivered. */
export const TRIAL_FEEDBACK_AUDIT_ACTION = "billing.trial_feedback_sent" as const;

/** Must match the audit row the route writes, or the dedupe silently misses. */
export const TRIAL_FEEDBACK_RESOURCE_TYPE = "subscription" as const;

/**
 * Statuses that mean a firm still has a working subscription. Mirrors the
 * list in webhook-handlers/customer-subscription-upserted.ts and the partial
 * unique index on the table.
 */
const LIVE_STATUSES = ["trialing", "active", "past_due", "unpaid"];

export type TrialCancelCandidate = {
  firmId: string;
  firmName: string | null;
  /** Stripe subscription id — also the audit resourceId that dedupes sends. */
  subscriptionId: string;
  canceledAt: Date;
};

export type TrialCancelRecipient = { email: string; firstName: string | null };

/**
 * Advisors who cancelled a running trial between LOOKBACK_MS and DELAY_MS ago.
 *
 * `canceled_at < trial_end` is what makes this "cancelled the trial" rather
 * than "stopped paying": a trial that simply lapsed has canceled_at AT its
 * trial end, and a paying customer's is long after it. Neither of those people
 * is the one this note is addressed to.
 *
 * Someone who cancels and then changes their mind drops out on their own —
 * Stripe clears canceled_at when a cancellation is reversed and the
 * subscription upsert handler mirrors that null, so they stop matching before
 * the 24 hours are up. Someone who comes back on a WHOLE NEW subscription
 * keeps this stale row forever, though, so the notExists below drops any firm
 * that currently has a live one. Asking a paying customer why they left is the
 * worst thing this job could do.
 *
 * Note it keys off canceled_at, NOT cancel_at_period_end: this Stripe account
 * schedules cancellations with `cancel_at` (a date), which leaves that boolean
 * false on a subscription that has genuinely been cancelled.
 */
export async function findTrialCancellations(
  now: Date = new Date(),
): Promise<TrialCancelCandidate[]> {
  const until = new Date(now.getTime() - DELAY_MS);
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const other = alias(subscriptions, "other_sub");

  const rows = await db
    .select({
      firmId: subscriptions.firmId,
      firmName: firms.displayName,
      subscriptionId: subscriptions.stripeSubscriptionId,
      canceledAt: subscriptions.canceledAt,
    })
    .from(subscriptions)
    // LEFT, not INNER: the firm name is only used for reporting, and a missing
    // firms row must not quietly remove someone from the list.
    .leftJoin(firms, eq(firms.firmId, subscriptions.firmId))
    .where(
      and(
        isNotNull(subscriptions.canceledAt),
        gte(subscriptions.canceledAt, since),
        lt(subscriptions.canceledAt, until),
        isNotNull(subscriptions.trialEnd),
        lt(subscriptions.canceledAt, subscriptions.trialEnd),
        notExists(
          db
            .select({ one: sql`1` })
            .from(other)
            .where(
              and(
                eq(other.firmId, subscriptions.firmId),
                ne(other.id, subscriptions.id),
                inArray(other.status, LIVE_STATUSES),
              ),
            ),
        ),
      ),
    );

  // isNotNull() above already excludes these; the filter is here to narrow the
  // type rather than to change the result.
  return rows.flatMap((r) =>
    r.canceledAt ? [{ ...r, canceledAt: r.canceledAt }] : [],
  );
}

/**
 * Drop anyone this note has already reached. The audit row is written only
 * after a confirmed delivery, so a failed send is retried on the next run
 * rather than silently dropped.
 */
export async function dropAlreadySent(
  candidates: TrialCancelCandidate[],
): Promise<TrialCancelCandidate[]> {
  if (candidates.length === 0) return [];

  const sent = await db
    .select({ resourceId: auditLog.resourceId })
    .from(auditLog)
    .where(
      and(
        // resourceType first: audit_log_resource_idx is on
        // (resource_type, resource_id), and without its leading column this
        // degrades to a sequential scan of an append-only table.
        eq(auditLog.resourceType, TRIAL_FEEDBACK_RESOURCE_TYPE),
        eq(auditLog.action, TRIAL_FEEDBACK_AUDIT_ACTION),
        inArray(
          auditLog.resourceId,
          candidates.map((c) => c.subscriptionId),
        ),
      ),
    );

  const seen = new Set(sent.map((s) => s.resourceId));
  return candidates.filter((c) => !seen.has(c.subscriptionId));
}

/**
 * The firm's billing contact — the person who actually clicked cancel, near
 * enough. Returns null for a firm with no reachable contact.
 */
export async function resolveRecipient(
  firmId: string,
): Promise<TrialCancelRecipient | null> {
  const contact = await resolveBillingContact(firmId);
  if (!contact?.email) return null;

  let firstName: string | null = null;
  try {
    const cc = await clerkClient();
    firstName = (await cc.users.getUser(contact.userId)).firstName ?? null;
  } catch {
    // A missing first name costs the greeting, nothing more. Never skip a
    // send over it.
  }
  return { email: contact.email, firstName };
}

/**
 * Plain text on purpose, and no logo, button or footer chrome. This is one
 * person asking another person a question; anything that looks like a campaign
 * gets answered like a campaign.
 */
export function buildTrialFeedbackEmail(firstName: string | null): {
  subject: string;
  text: string;
} {
  const text = [
    firstName ? `Hi ${firstName},` : "Hi there,",
    "",
    "I saw you cancelled your Foundry Planning trial. No hard feelings — and I'm",
    "not writing to talk you back into it.",
    "",
    "I'm the founder, and I'd really like to know what happened. If you have a",
    "minute, just hit reply and tell me:",
    "",
    "  1. What were you hoping Foundry would do for you?",
    "  2. Where did it fall short?",
    "  3. Did you go with something else instead? I won't be offended.",
    "",
    "Even a one-line answer is genuinely useful. Replies come straight to me and",
    "I read every one.",
    "",
    "Thanks for giving it a try,",
    "Dan",
    "",
    "--",
    "Dan Mueller",
    "Founder, Foundry Planning",
    "dan@foundryplanning.com",
    "",
    'Would you rather not hear from me? Reply "no thanks" and I\'ll leave you be.',
  ].join("\n");

  return { subject: "Can I ask why you cancelled?", text };
}

/**
 * Best-effort send that REPORTS delivery, mirroring lib/ops/growth/email.ts —
 * the caller only writes the audit row (and so stops retrying) on a true.
 */
export async function sendTrialFeedbackEmail(
  recipient: TrialCancelRecipient,
): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.TRIAL_FEEDBACK_FROM || FOUNDER_FROM;
  const replyTo = process.env.TRIAL_FEEDBACK_REPLY_TO || FOUNDER_REPLY_TO;

  if (!apiKey) {
    console.error("[trial-feedback] RESEND_API_KEY is not set — nothing can send");
    return { delivered: false };
  }

  const { subject, text } = buildTrialFeedbackEmail(recipient.firstName);

  try {
    const resend = new Resend(apiKey);
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // rather than throwing — the `error` check is the real net.
    const { error } = await resend.emails.send({
      from,
      to: recipient.email,
      replyTo,
      subject,
      text,
    });
    if (error) {
      console.error("[trial-feedback] Resend rejected the send:", error.message ?? error);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[trial-feedback] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false };
  }
}
