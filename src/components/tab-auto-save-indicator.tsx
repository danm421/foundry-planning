"use client";

interface TabAutoSaveIndicatorProps {
  saving: boolean;
  error: string | null;
  onDismissError: () => void;
}

export default function TabAutoSaveIndicator({
  saving,
  error,
  onDismissError,
}: TabAutoSaveIndicatorProps) {
  if (saving) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-ink-3"
        role="status"
        aria-live="polite"
      >
        <svg
          className="h-3 w-3 animate-spin text-ink-3"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-25"
          />
          <path
            d="M4 12a8 8 0 018-8"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        Saving…
      </span>
    );
  }
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-crit/40 bg-crit/10 px-2 py-0.5 text-xs text-crit">
        {error}
        <button
          type="button"
          onClick={onDismissError}
          className="text-crit/80 hover:text-crit"
          aria-label="Dismiss error"
        >
          ×
        </button>
      </span>
    );
  }
  return null;
}
