"use client";

// The dismissible line shown when a saved Add / Edit / Delete replaced unsaved
// Solver levers (see `useDraftReconciliation`).

export function DraftReconciliationNotice({ notice, onDismiss }: { notice: string | null; onDismiss: () => void }) {
  if (!notice) return null;
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 text-[12px] text-ink-2"
    >
      <span className="min-w-0 flex-1">{notice}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded px-1 text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        ×
      </button>
    </div>
  );
}
