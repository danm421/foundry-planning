"use client";
// src/components/fact-finder/save-status.tsx
// The header's save line: Saving / Saved / Not saved (with Retry), plus a
// refused edit or the dropped-edits notice, each dismissable.
import { AutosaveStatus } from "@/components/autosave-status";
import type { AutosaveState } from "@/components/forms/use-plan-settings-autosave";

interface SaveStatusProps {
  status: AutosaveState;
  error: string | null;
  notice: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

export function SaveStatus({ status, error, notice, onRetry, onDismiss }: SaveStatusProps) {
  // A failed save is already spelled out by AutosaveStatus ("Not saved — …").
  const refusal = status === "error" ? null : error;
  return (
    <div className="flex max-w-sm flex-col items-end gap-1 text-right">
      <AutosaveStatus state={status} error={error} onRetry={onRetry} />
      {(refusal || notice) && (
        <div className="flex items-start gap-2 text-[12px]">
          <div className="flex flex-col gap-0.5">
            {refusal && (
              <p role="alert" className="text-crit">
                {refusal}
              </p>
            )}
            {notice && (
              <p role="status" className="text-ink-3">
                {notice}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-ink-3 underline underline-offset-2 hover:text-ink hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
