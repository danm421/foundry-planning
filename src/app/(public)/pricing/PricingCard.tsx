"use client";

import { useState, useTransition } from "react";

type Cycle = "monthly" | "annual";

const COPY = {
  monthly: {
    headline: "$199",
    cadence: "per month",
    perWho: "per advisor",
    sub: "Billed monthly • cancel anytime",
    priceKey: "seatMonthly" as const,
  },
  annual: {
    headline: "$1,990",
    cadence: "per year",
    perWho: "per advisor",
    sub: "Billed annually • cancel anytime",
    priceKey: "seatAnnual" as const,
  },
};

export default function PricingCard() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const c = COPY[cycle];

  function startCheckout() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/checkout/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priceKey: c.priceKey }),
        });
        if (!res.ok) {
          setError("Couldn't start checkout — please try again.");
          return;
        }
        const { url } = (await res.json()) as { url: string };
        window.location.assign(url);
      } catch {
        setError("Couldn't start checkout — please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-hair bg-paper p-8">
      <div className="mb-6 inline-flex rounded-md border border-hair p-1 text-xs font-mono uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setCycle("monthly")}
          className={
            cycle === "monthly"
              ? "rounded bg-accent px-3 py-1.5 text-accent-on"
              : "px-3 py-1.5 text-ink-3 hover:text-ink"
          }
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setCycle("annual")}
          className={
            cycle === "annual"
              ? "rounded bg-accent px-3 py-1.5 text-accent-on"
              : "px-3 py-1.5 text-ink-3 hover:text-ink"
          }
        >
          Annual
          <span className="ml-2 rounded bg-hair px-1.5 py-0.5 text-[10px] text-accent">
            save 17%
          </span>
        </button>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-semibold tracking-tight tabular-nums">
          {c.headline}
        </span>
        <span className="text-sm text-ink-2">
          {c.cadence} • {c.perWho}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-3">{c.sub}</p>

      <ul className="mt-8 space-y-2 text-sm text-ink-2">
        <li>✓ Cash-flow projection engine</li>
        <li>✓ Federal + state tax engine with drill-down</li>
        <li>✓ Estate planning + Monte Carlo</li>
        <li>✓ Unlimited clients per advisor</li>
        <li>✓ Branded reports + PDF export</li>
      </ul>

      <div className="mt-8 rounded-md border border-dashed border-hair p-4 text-sm">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
          Optional add-on
        </p>
        <p className="mt-1 text-ink">
          AI Import — $99/mo per firm
        </p>
        <p className="text-ink-3">First 3 client onboardings free</p>
      </div>

      <button
        type="button"
        onClick={startCheckout}
        disabled={isPending}
        className="mt-8 w-full rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-on hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Redirecting…" : "Start 14-day trial"}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
