"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { textareaClassName, fieldLabelClassName } from "@/components/forms/input-styles";

const ADJ_MIN = -25;
const ADJ_MAX = 25;

function formatAdjustment(adj: number): string {
  if (adj > 0) return `+${adj}`;
  return String(adj);
}

interface EnvironmentEditorProps {
  clientId: string;
  adjustment: number;
  reason: string | null;
}

/**
 * "Edit" affordance on the Environment card. Expands in place (rather than a
 * modal) since it's one slider and one textarea -- a dialog would be more
 * chrome than content. Save stays disabled client-side whenever the
 * adjustment is non-zero and the reasoning is blank, mirroring
 * ENVIRONMENT_SCHEMA's paired refine rather than relying on the 400 alone.
 */
export function EnvironmentEditor({ clientId, adjustment, reason }: EnvironmentEditorProps) {
  const router = useRouter();
  const sliderId = useId();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(adjustment);
  const [reasonText, setReasonText] = useState(reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setValue(adjustment);
    setReasonText(reason ?? "");
    setError(null);
    setOpen(true);
  }

  const reasonBlank = reasonText.trim().length === 0;
  const disableSave = (value !== 0 && reasonBlank) || saving;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/risk/environment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustment: value,
          reason: reasonText.trim().length > 0 ? reasonText : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Failed to save.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="rounded-md border border-hair px-2.5 py-1 text-xs text-ink-2 hover:border-hair-2 hover:text-ink"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-hair bg-card-2 p-3">
      <div>
        <label htmlFor={sliderId} className={fieldLabelClassName}>
          Adjustment
        </label>
        <input
          id={sliderId}
          type="range"
          min={ADJ_MIN}
          max={ADJ_MAX}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-ink-3">
          <span className="flex flex-col items-start gap-0.5">
            <span className="tabular">-25</span>
            <span>Significantly less risk</span>
          </span>
          <span className="tabular self-end">-12</span>
          <span className="flex flex-col items-center gap-0.5">
            <span className="tabular">0</span>
            <span>No adjustment</span>
          </span>
          <span className="tabular self-end">+12</span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="tabular">+25</span>
            <span>Significantly more risk</span>
          </span>
        </div>
        <p className="tabular mt-1 text-center text-sm text-ink">{formatAdjustment(value)}</p>
      </div>
      <div>
        <label htmlFor={reasonId} className={fieldLabelClassName}>
          Reasoning{value !== 0 && " (required)"}
        </label>
        <textarea
          id={reasonId}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={3}
          className={textareaClassName}
          placeholder="Why is the environment being adjusted?"
        />
      </div>
      <p className="text-xs text-ink-3">
        Capacity still caps the profile. If real assets sit outside the plan, model them in the
        plan instead.
      </p>
      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={disableSave}
          className="btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="btn-ghost h-8 px-3 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
