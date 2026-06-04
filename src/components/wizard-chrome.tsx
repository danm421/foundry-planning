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
        <div className="mb-2 flex items-center justify-between text-sm text-ink-3">
          <span>
            Quick Start · Step {current + 1} of {stepLabels.length}
          </span>
          <span>{stepLabels[current]}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <h1 className="mb-4 text-xl font-semibold text-ink-1">{title}</h1>
      <div className="mb-8">{children}</div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled || busy}
          className="rounded-md border border-hair px-4 py-2 text-sm text-ink-2 disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || busy}
          className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-on disabled:opacity-40"
        >
          {busy ? "Saving…" : nextLabel}
        </button>
      </div>
    </div>
  );
}
