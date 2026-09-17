"use client";

import { useState, type ReactElement } from "react";
import type { CheckoutPlan } from "@/lib/billing/checkout";
import { startResubscribeCheckout } from "./actions";

function navigateTo(url: string) {
  window.location.href = url;
}

const PLANS: { value: CheckoutPlan; label: string }[] = [
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
];

/**
 * The self-serve way back onto a paid plan for a firm whose Founder comp
 * ended. Matches /welcome's checkout handoff: the action returns a Stripe URL
 * and this navigates to it, so a Stripe outage surfaces as an inline message
 * rather than taking out the one page a read-only firm can still act on.
 */
export default function ResubscribeButton({
  // Injectable for the same reason /welcome's SetupForm injects it: jsdom
  // cannot navigate, and assigning window.location.href there only warns — so
  // the redirect would otherwise be the one step no test can reach.
  navigate = navigateTo,
}: { navigate?: (url: string) => void } = {}): ReactElement {
  const [plan, setPlan] = useState<CheckoutPlan>("annual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubscribe() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("plan", plan);
    const started = await startResubscribeCheckout(fd);
    if (!started.ok) {
      setError(started.error);
      setBusy(false);
      return;
    }
    navigate(started.url);
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption uppercase tracking-[0.08em] text-ink-4">
          Billing period
        </legend>
        <div className="flex gap-2">
          {PLANS.map((p) => (
            <label
              key={p.value}
              className={`cursor-pointer rounded border px-3 py-1.5 text-sm transition-colors ${
                plan === p.value
                  ? "border-accent text-ink"
                  : "border-hair text-ink-3 hover:border-hair-2"
              }`}
            >
              <input
                type="radio"
                name="plan"
                value={p.value}
                checked={plan === p.value}
                onChange={() => setPlan(p.value)}
                className="sr-only"
              />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        onClick={onSubscribe}
        disabled={busy}
        className="btn-primary w-fit text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Opening Stripe…" : "Subscribe"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}
