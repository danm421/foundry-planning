// src/components/wizard-chrome.tsx
"use client";
import type { ReactNode } from "react";

interface WizardChromeProps {
  stepLabels: readonly string[];
  /** Small uppercase label above the progress bar naming the flow. */
  eyebrow: string;
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
  eyebrow,
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
  // flex-1 only bites when the parent is a full-height flex column (the intake
  // wizard); elsewhere the container stays content-height as before. Either way
  // the footer sticks to the bottom of the viewport while the body scrolls.
  return (
    // No bottom padding: the footer's own py-4 is the page's bottom gutter, so
    // its resting position matches where sticky pins it mid-scroll.
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          <span>{eyebrow}</span>
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
      <div className="mb-8 flex-1">{children}</div>
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between border-t border-hair bg-paper/95 px-4 py-4 backdrop-blur">
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
