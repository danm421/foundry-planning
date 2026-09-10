"use client";

import type { AutosaveState } from "@/components/forms/use-plan-settings-autosave";

interface AutosaveStatusProps {
  state: AutosaveState;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Stands in for the Save button on an autosaving form.
 *
 * Always rendered, for two reasons: the live region has to exist before the
 * first save for a screen reader to hear the second one, and the idle copy is
 * what tells an advisor who went looking for a Save button that there isn't
 * one.
 */
export function AutosaveStatus({ state, error, onRetry, className }: AutosaveStatusProps) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex min-h-5 items-center gap-1.5 text-[12px] ${className ?? ""}`}
    >
      {state === "idle" && <span className="text-ink-4">Changes save automatically</span>}
      {state === "saving" && <span className="text-ink-3">Saving…</span>}
      {state === "saved" && (
        <span className="inline-flex items-center gap-1 text-ink-3">
          <CheckIcon />
          Saved
        </span>
      )}
      {state === "error" && (
        <span className="inline-flex items-center gap-2 text-crit">
          <span>Not saved — {error ?? "unknown error"}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          )}
        </span>
      )}
    </span>
  );
}
