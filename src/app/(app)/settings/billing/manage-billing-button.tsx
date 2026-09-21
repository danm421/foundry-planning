"use client";

import type { ReactElement } from "react";
import { useFormStatus } from "react-dom";
import type { PlanSwitchState } from "@/lib/billing/plan-switch";
import { cancelPlanSwitchAction } from "./actions";

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

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The switch control renders from live Stripe state, so a pending change is
 * visible on every visit rather than in a one-shot query-parameter notice that
 * vanishes on refresh.
 *
 * When something is pending the page offers cancel and never a switch.
 * Offering both is how a customer reached "a subscription change is already
 * scheduled. Contact support." — the page said their cycle was monthly and
 * gave them a button that could only fail.
 */
export default function ManageBillingButton({
  switchState,
  canSwitch,
}: {
  switchState: PlanSwitchState;
  canSwitch: boolean;
}): ReactElement {
  const targetPlan =
    switchState.kind === "none"
      ? switchState.currentPlan === "annual"
        ? "monthly"
        : "annual"
      : null;

  return (
    <section id="manage" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-ink">Manage billing</h2>
        {switchState.kind === "none" ? (
          <p className="text-sm text-ink-3">
            Your current billing cycle is{" "}
            <span className="font-medium capitalize text-ink">{switchState.currentPlan}</span>.
          </p>
        ) : null}
        {switchState.kind === "pending" ? (
          <p className="text-sm text-ink-3">
            You&apos;re on{" "}
            <span className="font-medium capitalize text-ink">{switchState.currentPlan}</span>,
            switching to{" "}
            <span className="font-medium capitalize text-ink">{switchState.targetPlan}</span> on{" "}
            <span className="tabular text-ink">{fmtDate(switchState.effectiveAt)}</span>.
          </p>
        ) : null}
        {switchState.kind === "unavailable" ? (
          <p className="text-sm text-ink-3">
            We couldn&apos;t reach Stripe to read your billing cycle, so cycle changes are
            unavailable right now. Your subscription is unaffected.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {targetPlan && canSwitch ? (
          <a
            href={`/settings/billing/switch?plan=${targetPlan}`}
            className="btn-primary min-h-11 px-3 text-sm"
          >
            Switch to {targetPlan}
          </a>
        ) : null}
        {switchState.kind === "pending" ? (
          <form action={cancelPlanSwitchAction}>
            <SubmitButton label="Cancel scheduled change" pendingLabel="Cancelling…" />
          </form>
        ) : null}
        <form method="post" action="/api/billing/portal">
          <SubmitButton label="Cards, invoices & cancellation" pendingLabel="Opening Stripe…" />
        </form>
      </div>
      {switchState.kind === "pending" ? (
        <p className="max-w-xl text-sm text-ink-3">
          Cancelling costs nothing and leaves your current cycle exactly as it is.
        </p>
      ) : null}
    </section>
  );
}
