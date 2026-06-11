import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { ForbiddenError, requireOrgOwner } from "@/lib/authz";
import {
  getSubscriptionState,
  GRACE_WINDOW_MS,
  type SubscriptionState,
} from "@/lib/billing/subscription-state";
import Forbidden from "../forbidden";
import ManageBillingButton from "./manage-billing-button";

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

  // No readable subscription metadata → unprovisioned / broken account. The
  // middleware locks these out of the app; billing is the one surface they can
  // still reach, so show a clear recovery path instead of a dead-end "Unknown".
  if (state.kind === "missing") {
    return <InactiveAccountPanel />;
  }

  // firmId === Clerk org id. Skip the query entirely if there's no org.
  const rows: InvoiceRow[] = orgId
    ? await db
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
        .limit(INVOICE_PAGE_LIMIT)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Billing</h1>
        <p className="text-sm text-ink-3">
          Manage your subscription, update your card, or download invoices.
        </p>
      </header>
      <StateSummary state={state} />
      <ManageBillingButton />
      <InvoiceList rows={rows} />
    </div>
  );
}

export default async function BillingSettingsPage(): Promise<ReactElement> {
  try {
    await requireOrgOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="owner" />;
    }
    throw err;
  }

  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  return isFounder ? <FounderBillingPanel /> : <NonFounderBillingPanel />;
}
