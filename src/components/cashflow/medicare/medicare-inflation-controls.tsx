"use client";

import { useEffect, useState } from "react";
import { useClientAccess } from "@/components/client-access-provider";

interface Props {
  rate: number;
  enabled: boolean;
  onChange: (next: { rate?: number; enabled?: boolean }) => void;
  saveError: string | null;
}

function formatPct(n: number): string {
  return (n * 100).toFixed(2).replace(/\.?0+$/, "");
}

export function MedicareInflationControls({ rate, enabled, onChange, saveError }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const [rateInput, setRateInput] = useState(formatPct(rate));

  // Keep the input in sync if the prop changes from elsewhere (e.g. fresh load).
  useEffect(() => {
    setRateInput(formatPct(rate));
  }, [rate]);

  const commitRate = () => {
    const parsed = parseFloat(rateInput);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setRateInput(formatPct(rate));
      return;
    }
    const nextRate = parsed / 100;
    if (Math.abs(nextRate - rate) < 1e-6) return;
    onChange({ rate: nextRate });
  };

  return (
    <div className="rounded border border-line-2 bg-surface-2 px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      <span className="font-medium text-ink-2">Inflation assumptions</span>

      <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={canEdit ? (e) => onChange({ enabled: e.target.checked }) : undefined}
          disabled={!canEdit}
          className="h-3.5 w-3.5"
        />
        <span>Inflate Medicare premiums + IRMAA brackets forward</span>
      </label>

      <label className="flex items-center gap-2 text-ink-2">
        <span>Rate</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.25"
          min={0}
          max={100}
          value={rateInput}
          disabled={!enabled || !canEdit}
          onChange={(e) => setRateInput(e.target.value)}
          onBlur={canEdit ? commitRate : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-16 rounded border border-line-2 bg-surface px-2 py-1 text-right disabled:opacity-50"
        />
        <span className="text-ink-3">%/yr</span>
      </label>

      <span className="text-ink-3">
        Default 3%/yr. Historical Medicare premium growth has run ~4–6%.
      </span>

      {saveError && (
        <span className="text-crit">Save failed: {saveError}</span>
      )}
    </div>
  );
}
