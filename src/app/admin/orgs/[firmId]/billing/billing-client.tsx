"use client";

import { useState } from "react";
import type { FirmBilling } from "@/lib/ops/billing-admin";
import { openPortalAction, extendTrialAction } from "./actions";

const STATE_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300",
  trialing: "bg-sky-500/15 text-sky-300",
  active_canceling: "bg-amber-500/15 text-amber-300",
  past_due: "bg-amber-500/15 text-amber-300",
  unpaid: "bg-red-500/15 text-red-300",
  paused: "bg-ink-4/15 text-ink-2",
  canceled_grace: "bg-amber-500/15 text-amber-300",
  canceled_locked: "bg-red-500/15 text-red-300",
  founder: "bg-violet-500/15 text-violet-300",
  missing: "bg-ink-4/15 text-ink-2",
};

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function money(cents: number | null, currency: string | null) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hair py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default function BillingClient({
  firmId,
  isFounder,
  billing,
}: {
  firmId: string;
  isFounder: boolean;
  billing: FirmBilling;
}) {
  const { state, subscription, invoices, dashboardUrl, canExtendTrial } = billing;
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(14);

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-ink-2">Billing</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${STATE_STYLE[state.kind] ?? STATE_STYLE.missing}`}>
          {state.kind}
        </span>
      </div>

      {subscription ? (
        <div className="rounded border border-hair p-4">
          <dl className="text-sm">
            <Field label="Status">{subscription.status}</Field>
            <Field label="Trial ends">{fmt(subscription.trialEnd)}</Field>
            <Field label="Current period end">{fmt(subscription.currentPeriodEnd)}</Field>
            <Field label="Cancels at period end">{subscription.cancelAtPeriodEnd ? "Yes" : "No"}</Field>
            <Field label="Stripe customer">
              <span className="tabular text-xs">{subscription.stripeCustomerId}</span>
            </Field>
            <Field label="Stripe subscription">
              <span className="tabular text-xs">{subscription.stripeSubscriptionId}</span>
            </Field>
          </dl>
        </div>
      ) : (
        <p className="rounded border border-hair p-4 text-sm text-ink-3">
          {isFounder ? "Founder org — no Stripe subscription." : "No subscription on record."}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {billing.stripeCustomerId && (
          <form action={openPortalAction}>
            <input type="hidden" name="firmId" value={firmId} />
            <button
              type="submit"
              className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
            >
              Open customer portal
            </button>
          </form>
        )}
        {dashboardUrl && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-accent"
          >
            Open in Stripe ↗
          </a>
        )}
      </div>

      {/* Extend trial — only meaningful while trialing */}
      {canExtendTrial && (
        <form action={extendTrialAction} className="space-y-3 rounded border border-hair p-4">
          <input type="hidden" name="firmId" value={firmId} />
          <div className="text-sm font-medium text-ink-2">Extend trial</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-ink-2">
              Days
              <input
                name="days"
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="ml-2 w-20 rounded border border-hair-2 bg-card-2 px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <input
              required
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              className="flex-1 rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!reason.trim() || days < 1 || days > 90}
              className="rounded bg-good/15 px-3 py-1.5 text-sm text-good hover:bg-good/25 disabled:opacity-40"
            >
              Extend
            </button>
          </div>
          <p className="text-xs text-ink-3">
            Updates the trial in Stripe; the change syncs back via webhook and is recorded in the audit log.
          </p>
        </form>
      )}

      {/* Recent invoices */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-ink-2">Recent invoices</div>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-3">No invoices.</p>
        ) : (
          <div className="overflow-hidden rounded border border-hair">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Period end</th>
                  <th className="px-3 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.stripeInvoiceId} className="border-t border-hair">
                    <td className="px-3 py-2">{inv.status ?? "—"}</td>
                    <td className="px-3 py-2">{money(inv.amountPaid, inv.currency)}</td>
                    <td className="px-3 py-2">{money(inv.amountDue, inv.currency)}</td>
                    <td className="px-3 py-2">{fmt(inv.periodEnd)}</td>
                    <td className="px-3 py-2">
                      {inv.hostedInvoiceUrl ? (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          View ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
