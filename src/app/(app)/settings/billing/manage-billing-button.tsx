"use client";

import type { ReactElement } from "react";
import { useFormStatus } from "react-dom";
import type { BillingPlan } from "@/lib/billing/billing-plan";

function SubmitButton({ label, pendingLabel, primary = false }: {
  label: string;
  pendingLabel: string;
  primary?: boolean;
}): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${primary ? "btn-primary" : "btn-ghost"} min-h-11 w-fit cursor-pointer px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Native POST form to the Customer Portal route. The route returns a 303
 * redirect to Stripe's hosted portal, so a real form submit (not fetch)
 * lets the browser follow it straight there — no client-side redirect glue.
 */
export default function ManageBillingButton({
  currentPlan,
  canSwitch,
}: {
  currentPlan: BillingPlan | null;
  canSwitch: boolean;
}): ReactElement {
  const targetPlan: BillingPlan | null =
    currentPlan === "annual" ? "monthly" : currentPlan === "monthly" ? "annual" : null;

  return (
    <section id="manage" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-ink">Manage billing</h2>
        {currentPlan ? (
          <p className="text-sm text-ink-3">
            Your current billing cycle is{" "}
            <span className="font-medium capitalize text-ink">{currentPlan}</span>.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {targetPlan && canSwitch ? (
          <form method="post" action="/api/billing/portal">
            <input type="hidden" name="plan" value={targetPlan} />
            <SubmitButton
              label={`Switch to ${targetPlan}`}
              pendingLabel="Opening Stripe…"
              primary
            />
          </form>
        ) : null}
        <form method="post" action="/api/billing/portal">
          <SubmitButton label="Cards, invoices & cancellation" pendingLabel="Opening Stripe…" />
        </form>
      </div>
      {targetPlan && canSwitch ? (
        <p className="max-w-xl text-sm text-ink-3">
          Stripe will show the price and effective date before you confirm. Switching during a
          free trial keeps the current trial end date.
        </p>
      ) : null}
    </section>
  );
}
