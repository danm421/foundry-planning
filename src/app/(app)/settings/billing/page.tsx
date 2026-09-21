import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { ForbiddenError, requireBillingContact } from "@/lib/authz";
import { getFirmBillingPlan } from "@/lib/billing/billing-plan";
import {
  getSubscriptionState,
  GRACE_WINDOW_MS,
  type SubscriptionState,
} from "@/lib/billing/subscription-state";
import Forbidden from "../forbidden";
import ManageBillingButton from "./manage-billing-button";
import ResubscribeButton from "./resubscribe-button";

function FounderBillingPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Foundry Financial — Founder Plan</h1>
        <p className="text-sm text-ink-3">
          You have full access to all features as the founder of this product.
          No subscription is required.
        </p>
      </header>
      <div className="rounded border border-hair bg-card p-4 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-4">Subscription status</dt>
          <dd className="text-ink">founder</dd>
          <dt className="text-ink-4">Entitlements</dt>
          <dd className="text-ink">ai_import</dd>
        </dl>
      </div>
      <button
        type="button"
        disabled
        title="Founder accounts don't have a Stripe subscription."
        className="w-fit cursor-not-allowed rounded border border-hair bg-paper px-3 py-1.5 text-sm text-ink-4"
      >
        No subscription to manage
      </button>
    </div>
  );
}

/**
 * A firm whose Founder comp ops ended. Deliberately NOT the panel below:
 * `missing` means an unprovisioned or broken account, where "contact support"
 * is the right answer and checkout is the wrong one. This firm is fine — it
 * simply has to start paying, and until it does it keeps read access to
 * everything (see `decideAccess`), so the copy leads with that rather than
 * with a scare.
 */
function CompEndedPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Your complimentary access has ended</h1>
        <p className="text-sm text-ink-3">
          Everything you have built is still here and still readable. Subscribe
          to start editing again — your clients, plans and settings carry over
          exactly as they are.
        </p>
      </header>
      <ResubscribeButton />
    </div>
  );
}

/** Stripe sends a completed re-checkout back here. */
function ResubscribedNotice(): ReactElement {
  return (
    <div role="status" className="rounded border border-hair bg-card p-4 text-sm text-ink-2">
      Payment received — thank you. Your subscription is being activated; it can
      take a moment to show up here.
    </div>
  );
}

function PlanChangedNotice(): ReactElement {
  return (
    <div role="status" className="rounded border border-hair bg-card p-4 text-sm text-ink-2">
      Billing cycle updated. It can take a moment for the new cycle to appear here.
    </div>
  );
}

/**
 * Stripe defers a downgrade that still has a paid period left to run, so the
 * cycle below will keep reading the old one — for months, if they are a year
 * in. Promising an update that the page cannot show is what sent people back
 * to the button to press it again.
 */
function PlanChangeScheduledNotice(): ReactElement {
  return (
    <div role="status" className="rounded border border-hair bg-card p-4 text-sm text-ink-2">
      Billing cycle change confirmed. It takes effect at the end of the period
      you have already paid for, so your current cycle is shown below until then.
    </div>
  );
}

// The portal form redirects here so refusals stay within the billing page.
const BILLING_NOTICES: Record<string, { tone: "info" | "error"; message: string }> = {
  plan_change_scheduled: {
    tone: "info",
    message:
      "A subscription change is already scheduled. Contact support if you need to change it before it takes effect.",
  },
  plan_change_unavailable: {
    tone: "error",
    message:
      "Your billing cycle can't be changed right now. Check your subscription status below, or contact support for help.",
  },
  already_on_plan: {
    tone: "info",
    message: "You're already on that billing cycle.",
  },
  no_subscription: {
    tone: "error",
    message: "There's no Stripe subscription on this account to manage.",
  },
  invalid_plan: {
    tone: "error",
    message: "That isn't a billing cycle we offer.",
  },
  portal_unavailable: {
    tone: "error",
    message:
      "We couldn't open Stripe. Please try again, or contact support if it keeps happening.",
  },
  plan_change_incomplete: {
    tone: "error",
    message:
      "Your previous scheduled change was removed. If you haven't confirmed a replacement in Stripe, your current billing cycle still applies. Use Switch below to finish changing it, or contact support for help.",
  },
};

function BillingActionNotice({ code, plan, schedule }: {
  code: string;
  plan?: string;
  schedule?: string;
}): ReactElement | null {
  if (code === "trial_change_scheduled" && (plan === "monthly" || plan === "annual") && schedule) {
    return (
      <div className="flex flex-col gap-3 rounded border border-hair bg-card p-4 text-sm text-ink-2">
        <p role="status">
          You already have a change scheduled for this subscription. To switch to {plan} now,
          first remove that change, then confirm the replacement in Stripe. If you leave Stripe
          without confirming, your current billing cycle will still apply. Your trial end date stays the same.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form method="post" action="/api/billing/portal">
            <input type="hidden" name="plan" value={plan} />
            <input type="hidden" name="replace_schedule" value={schedule} />
            <button type="submit" className="btn-primary min-h-11 cursor-pointer px-3 text-sm">
              Replace scheduled change
            </button>
          </form>
          <a href="/settings/billing" className="btn-ghost min-h-11 px-3 text-sm">
            Keep scheduled change
          </a>
        </div>
      </div>
    );
  }
  if (!Object.hasOwn(BILLING_NOTICES, code)) return null;
  const notice = BILLING_NOTICES[code];
  return notice.tone === "error" ? (
    <div role="alert" className="rounded border border-crit bg-crit/10 p-4 text-sm text-crit">
      {notice.message}
    </div>
  ) : (
    <div role="status" className="rounded border border-hair bg-card p-4 text-sm text-ink-2">
      {notice.message}
    </div>
  );
}

function InactiveAccountPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Account not active</h1>
        <p className="text-sm text-ink-3">
          We can&apos;t read an active subscription for this account, so access
          is paused. Setup may not have finished. Sign out and back in to
          refresh — if it persists, contact support.
        </p>
      </header>
      <div className="flex items-center gap-3">
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="w-fit rounded border border-hair bg-paper px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent"
          >
            Sign out
          </button>
        </SignOutButton>
        <a
          href="mailto:support@foundryplanning.com"
          className="text-sm font-medium text-accent underline"
        >
          Contact support
        </a>
      </div>
    </div>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtAmount(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

const STATUS_LABEL: Record<SubscriptionState["kind"], string> = {
  founder: "Founder",
  trialing: "Trialing",
  active: "Active",
  active_canceling: "Canceling at period end",
  past_due: "Past due",
  unpaid: "Unpaid",
  paused: "Paused",
  canceled_grace: "Canceled — read-only grace",
  canceled_locked: "Canceled — locked",
  comp_ended: "Complimentary access ended",
  missing: "Unknown",
};

function StateSummary({ state }: { state: SubscriptionState }): ReactElement {
  const rows: [string, string][] = [["Status", STATUS_LABEL[state.kind]]];
  if (state.kind === "trialing") {
    rows.push(["Trial ends", fmtDate(state.trialEndsAt)]);
  } else if (state.kind === "active_canceling") {
    rows.push(["Access ends", fmtDate(state.periodEnd)]);
  } else if (state.kind === "canceled_grace") {
    const graceUntil = new Date(
      state.archivedAt.getTime() + GRACE_WINDOW_MS,
    );
    rows.push(["Read-only until", fmtDate(graceUntil)]);
  }
  return (
    <div className="rounded border border-hair bg-card p-4 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-4">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type InvoiceRow = {
  stripeInvoiceId: string;
  amountPaid: number | null;
  amountDue: number | null;
  currency: string | null;
  status: string | null;
  paidAt: Date | null;
  createdAt: Date;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

function InvoiceList({ rows }: { rows: InvoiceRow[] }): ReactElement {
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">Invoices</h2>
        <p className="text-sm text-ink-3">No invoices yet.</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink">Invoices</h2>
      <div className="overflow-hidden rounded border border-hair">
        <table className="w-full text-sm">
          <caption className="sr-only">Invoices</caption>
          <thead className="bg-paper text-ink-4">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-normal">Date</th>
              <th scope="col" className="px-3 py-2 text-left font-normal">Amount</th>
              <th scope="col" className="px-3 py-2 text-left font-normal">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.stripeInvoiceId} className="border-t border-hair">
                <td className="px-3 py-2 text-ink">
                  {fmtDate(inv.paidAt ?? inv.createdAt)}
                </td>
                <td className="px-3 py-2 text-ink">
                  {fmtAmount(inv.amountPaid ?? inv.amountDue, inv.currency)}
                </td>
                <td className="px-3 py-2 text-ink-3">{inv.status ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {inv.hostedInvoiceUrl ? (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent underline"
                    >
                      View
                    </a>
                  ) : inv.invoicePdf ? (
                    <a
                      href={inv.invoicePdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent underline"
                    >
                      PDF
                    </a>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const INVOICE_PAGE_LIMIT = 24; // ~2 years of monthly invoices

export async function NonFounderBillingPanel(): Promise<ReactElement> {
  const [{ orgId }, state] = await Promise.all([auth(), getSubscriptionState()]);

  // An ops-ended comp. Checked before `missing` because the two must never be
  // answered the same way: this firm needs a checkout button, a `missing` one
  // needs support.
  if (state.kind === "comp_ended") {
    return <CompEndedPanel />;
  }

  // No readable subscription metadata → unprovisioned / broken account. The
  // middleware locks these out of the app; billing is the one surface they can
  // still reach, so show a clear recovery path instead of a dead-end "Unknown".
  if (state.kind === "missing") {
    return <InactiveAccountPanel />;
  }

  // firmId === Clerk org id. Skip the query entirely if there's no org.
  const [rows, currentPlan]: [InvoiceRow[], Awaited<ReturnType<typeof getFirmBillingPlan>>] = orgId
    ? await Promise.all([
        db
        .select({
          stripeInvoiceId: invoices.stripeInvoiceId,
          amountPaid: invoices.amountPaid,
          amountDue: invoices.amountDue,
          currency: invoices.currency,
          status: invoices.status,
          paidAt: invoices.paidAt,
          createdAt: invoices.createdAt,
          hostedInvoiceUrl: invoices.hostedInvoiceUrl,
          invoicePdf: invoices.invoicePdf,
        })
        .from(invoices)
        .where(eq(invoices.firmId, orgId))
        .orderBy(desc(invoices.createdAt))
        .limit(INVOICE_PAGE_LIMIT),
        getFirmBillingPlan(orgId),
      ])
    : [[], null];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Billing</h1>
        <p className="text-sm text-ink-3">
          Manage your subscription, update your card, or download invoices.
        </p>
      </header>
      <StateSummary state={state} />
      <ManageBillingButton
        currentPlan={currentPlan}
        canSwitch={state.kind === "trialing" || state.kind === "active"}
      />
      <InvoiceList rows={rows} />
    </div>
  );
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    resubscribed?: string | string[];
    plan_changed?: string | string[];
    billing_error?: string | string[];
    plan?: string | string[];
    schedule?: string | string[];
  }>;
}): Promise<ReactElement> {
  try {
    await requireBillingContact();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="billing contact" />;
    }
    throw err;
  }

  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  // Stripe's success_url for a re-checkout lands here. Driven by the redirect
  // rather than by the state, because the session token lags: for up to a
  // token refresh after checkout it can still carry `is_founder: true`, which
  // routes to FounderBillingPanel. Rendering the notice ABOVE that branch is
  // what stops it being dropped on exactly the visit it exists for.
  const sp = await searchParams;
  const rawFlag = sp?.resubscribed;
  const resubscribed = (Array.isArray(rawFlag) ? rawFlag[0] : rawFlag) === "1";
  const rawPlanChanged = sp?.plan_changed;
  const planChanged = Array.isArray(rawPlanChanged) ? rawPlanChanged[0] : rawPlanChanged;
  const rawBillingError = sp?.billing_error;
  const billingErrorCode = Array.isArray(rawBillingError)
    ? rawBillingError[0]
    : rawBillingError;

  return (
    <div className="flex flex-col gap-4">
      {resubscribed ? <ResubscribedNotice /> : null}
      {planChanged === "1" ? <PlanChangedNotice /> : null}
      {planChanged === "scheduled" ? <PlanChangeScheduledNotice /> : null}
      {billingErrorCode ? <BillingActionNotice
        code={billingErrorCode}
        plan={Array.isArray(sp?.plan) ? sp.plan[0] : sp?.plan}
        schedule={Array.isArray(sp?.schedule) ? sp.schedule[0] : sp?.schedule}
      /> : null}
      {isFounder ? <FounderBillingPanel /> : <NonFounderBillingPanel />}
    </div>
  );
}
