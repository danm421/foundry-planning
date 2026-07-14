"use client";

import type { ReactNode } from "react";

// Inline Lucide `rotate-ccw` — lucide-react is not a dependency in this repo
// (see solver-tab-icons.tsx for the same pattern). Outline-only, strokeWidth
// 1.5, currentColor — per the Foundry design system.
function RotateCcwIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

interface Props<T> {
  base: T;
  working: T;
  /** Renders the base value for display. Defaults to String(base). */
  format?: (v: T) => ReactNode;
  /** When provided, renders a "Reset to <base>" affordance that clears this field. */
  onReset?: () => void;
  /** Override the changed check (e.g. tolerance for floats). Default !Object.is. */
  changed?: boolean;
}

/**
 * Inline "changed" hint. Renders null when the value is unchanged.
 * With `onReset`, shows a prominent "Reset to <base>" action so it's obvious
 * both that the field changed and what it will revert to. Without a reset
 * handler, falls back to a passive "base was <base>" note.
 */
export function SolverBaseHint<T>({ base, working, format, onReset, changed }: Props<T>) {
  const isChanged = changed ?? !Object.is(base, working);
  if (!isChanged) return null;
  const baseLabel = format ? format(base) : String(base);
  if (onReset) {
    return (
      <button
        type="button"
        onClick={onReset}
        className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:underline"
      >
        <RotateCcwIcon />
        Reset to <span className="tabular">{baseLabel}</span>
      </button>
    );
  }
  return (
    <div className="mt-0.5 text-[11px] text-ink-4">
      base was <span className="text-ink-3 tabular">{baseLabel}</span>
    </div>
  );
}
