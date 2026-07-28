"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { RISK_LEVELS, RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";
import { textareaClassName, fieldLabelClassName } from "@/components/forms/input-styles";

interface ManualToleranceDialogProps {
  clientId: string;
  /** Current tolerance rung, or null when no tolerance has been established
   *  yet. Used only to preselect the radio group when the dialog opens. */
  currentLevel: RiskLevel | null;
}

/**
 * "Set manually" affordance on the Tolerance card -- lets an advisor pick a
 * rung by hand instead of running the questionnaire. Reasoning is mandatory:
 * the Save button stays disabled until the advisor writes one, mirroring the
 * server's non-empty-reason requirement rather than relying on the 400 alone.
 */
export function ManualToleranceDialog({ clientId, currentLevel }: ManualToleranceDialogProps) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<RiskLevel>(currentLevel ?? "moderate");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setLevel(currentLevel ?? "moderate");
    setReason("");
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/risk/tolerance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, reason }),
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

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md border border-hair px-2.5 py-1 text-xs text-ink-2 hover:border-hair-2 hover:text-ink"
      >
        Set manually
      </button>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title="Set tolerance manually"
        size="sm"
        primaryAction={{
          label: "Save",
          onClick: handleSave,
          disabled: reason.trim().length === 0,
          loading: saving,
        }}
      >
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Rung</legend>
            {RISK_LEVELS.map((lvl) => (
              <label key={lvl} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="tolerance-level"
                  value={lvl}
                  checked={level === lvl}
                  onChange={() => setLevel(lvl)}
                  className="accent-accent"
                />
                <span className="text-[13px] text-ink">{RISK_LEVEL_LABELS[lvl]}</span>
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor={reasonId} className={fieldLabelClassName}>
              Reasoning
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={textareaClassName}
              placeholder="Why is the tolerance being set by hand?"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-crit">
              {error}
            </p>
          )}
        </div>
      </DialogShell>
    </>
  );
}
