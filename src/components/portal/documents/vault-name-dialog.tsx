"use client";
import { useId, useState } from "react";
import type { ReactElement } from "react";
import DialogShell from "@/components/dialog-shell";

/**
 * Single-field name dialog used for both "New folder" and renaming a folder or
 * file. Built on DialogShell so it inherits the ref-counted body scroll lock,
 * Escape-to-close, focus trap, and return-focus.
 */
export function VaultNameDialog({
  title,
  label,
  initialValue = "",
  confirmLabel,
  maxLength = 255,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  maxLength?: number;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void>;
}): ReactElement {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initialValue.trim() && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title={title}
      size="sm"
      primaryAction={{ label: confirmLabel, onClick: () => void submit(), disabled: !canSubmit, loading: saving }}
    >
      <label htmlFor={inputId} className="block space-y-1.5">
        <span className="text-[13px] text-ink-2">{label}</span>
        <input
          id={inputId}
          autoFocus
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          className="w-full rounded-md border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-[12px] text-crit">{error}</p>}
    </DialogShell>
  );
}
