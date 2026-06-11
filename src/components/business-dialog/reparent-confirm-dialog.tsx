"use client";

import { FieldTooltip } from "@/components/forms/field-tooltip";

export interface ReparentConfirmDialogProps {
  open: boolean;
  targetName: string;
  businessName: string;
  currentOwnersLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function ReparentConfirmDialog({
  open,
  targetName,
  businessName,
  currentOwnersLabel,
  onCancel,
  onConfirm,
  loading,
}: ReparentConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-paper/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-[480px] rounded-[var(--radius)] border-2 border-ink-3 ring-1 ring-black/60 bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-1.5 text-[14px] text-ink">
          <span>
            Reassign <strong>{targetName}</strong> to <strong>{businessName}</strong>?
          </span>
          <FieldTooltip text="This will overwrite the current ownership. The business will own this 100% via its existing owner structure." />
        </div>
        <p className="mt-2 text-[12px] text-ink-2">
          Current owner: <strong className="text-ink">{currentOwnersLabel}</strong>
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-[var(--radius-sm)] border border-transparent px-4 h-9 text-[13px] font-medium text-ink-2 hover:text-ink hover:bg-card-hover hover:border-hair"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-[var(--radius-sm)] bg-accent text-paper px-4 h-9 text-[13px] font-medium hover:bg-accent-ink disabled:opacity-50"
          >
            {loading ? "Reassigning…" : "Confirm reassign"}
          </button>
        </div>
      </div>
    </div>
  );
}
