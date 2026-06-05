// src/components/wizard-chrome.tsx
"use client";
import type { ReactNode } from "react";

interface WizardChromeProps {
  stepLabels: readonly string[];
  /** 0-based index of the active step. */
  current: number;
  title: string;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  busy?: boolean;
}

export function WizardChrome({
  stepLabels,
  current,
  title,
  children,
  onBack,
  onNext,
  nextLabel = "Next",
  backDisabled,
  nextDisabled,
  busy,
}: WizardChromeProps) {
  const pct = Math.round(((current + 1) / stepLabels.length) * 100);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          <span>Quick Start</span>
          <span className="tabular">
            Step {current + 1} / {stepLabels.length} · {stepLabels[current]}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-card-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <h1 className="mb-5 text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mb-8">{children}</div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled || busy}
          className="rounded-[var(--radius-sm)] border border-hair px-4 py-2 text-sm text-ink-2 transition-colors hover:border-hair-2 hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || busy}
          className="rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-sm font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : nextLabel}
        </button>
      </div>
    </div>
  );
}
