"use client";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";

export function RecurringProgressRing({
  leftToPay,
  paidSoFar,
}: {
  leftToPay: number;
  paidSoFar: number;
}): ReactElement {
  const total = leftToPay + paidSoFar;
  const frac = total > 0 ? Math.min(1, paidSoFar / total) : 0;
  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <section className="flex items-center justify-between gap-4 rounded-xl border border-hair bg-card p-5">
      <div>
        <p className="tabular text-[20px] font-semibold text-ink">{fmtUsd(leftToPay)}</p>
        <p className="text-[12px] text-ink-3">left to pay</p>
      </div>
      <svg viewBox="0 0 80 80" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-hair)" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${frac * circ} ${circ}`}
        />
      </svg>
      <div className="text-right">
        <p className="tabular text-[20px] font-semibold text-ink">{fmtUsd(paidSoFar)}</p>
        <p className="text-[12px] text-ink-3">paid so far</p>
      </div>
    </section>
  );
}
