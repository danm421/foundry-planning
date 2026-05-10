"use client";

import { useState } from "react";

export type ChipFormat = "pct" | "currency" | "year" | "int";

interface Props {
  label: string;
  currentValue: number;
  format: ChipFormat;
  onSave: (next: number) => Promise<void>;
  onCancel: () => void;
}

/**
 * ChipEditor — generic inline number-input form used by the ChipBar.
 * Renders a small horizontal form with a label, numeric input, and Save/Cancel
 * buttons. Surfaces errors thrown from `onSave` inline.
 */
export function ChipEditor({ label, currentValue, format, onSave, onCancel }: Props) {
  const [value, setValue] = useState<number>(currentValue);
  const [raw, setRaw] = useState<string>(String(currentValue));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step =
    format === "pct" ? "0.001" : format === "currency" ? "1" : format === "year" ? "1" : "1";

  return (
    <form
      role="form"
      className="flex items-center gap-2 rounded border border-hair bg-card-2 p-3 shadow-lg"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (raw.trim() === "" || Number.isNaN(value)) {
          setError("Enter a number");
          return;
        }
        setBusy(true);
        try {
          await onSave(value);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="text-[11px] uppercase tracking-wider text-ink-3">{label}</span>
      <input
        type="number"
        step={step}
        value={raw}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setRaw(e.target.value);
          setValue(parseFloat(e.target.value));
          if (error) setError(null);
        }}
        className="w-24 rounded border border-hair bg-card px-2 py-1 tabular-nums text-ink"
      />
      <button
        type="submit"
        disabled={busy}
        className="text-[12px] text-accent hover:text-accent-ink disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-[12px] text-ink-3 hover:text-ink"
      >
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-crit">
          {error}
        </span>
      )}
    </form>
  );
}
