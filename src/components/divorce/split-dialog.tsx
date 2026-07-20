"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { fieldLabelClassName, inputBaseClassName } from "@/components/forms/input-styles";
import { splitAmounts } from "@/lib/divorce/split-math";
import type { DivisibleObject } from "@/lib/divorce/allocation-rules";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The allocation rules accept only 0 < pct < 100; keep the control in-range. */
const clampPct = (n: number) => Math.min(99, Math.max(1, Math.round(n)));

export interface SplitDialogProps {
  open: boolean;
  /** The object being split; null closes the dialog. */
  obj: DivisibleObject | null;
  /** Seeds the slider — the object's current split, or 50 for a fresh split. */
  initialPercentToSpouse: number;
  people: { primaryName: string; spouseName: string };
  onOpenChange: (open: boolean) => void;
  /** Fires with the chosen percent-to-spouse; the board threads it to onAllocate. */
  onConfirm: (percentToSpouse: number) => void;
}

export function SplitDialog({
  open,
  obj,
  initialPercentToSpouse,
  people,
  onOpenChange,
  onConfirm,
}: SplitDialogProps) {
  // Seeded once per mount; the board keys this dialog by object id, so opening
  // the split for a different object remounts with that object's own seed.
  const [pct, setPct] = useState(() => clampPct(initialPercentToSpouse));

  if (!obj) return null;

  const primaryName = people.primaryName || "Primary";
  const spouseName = people.spouseName || "Spouse";
  const shares = splitAmounts(obj.value, obj.basis, obj.rothValue, pct);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`Split ${obj.label}`}
      size="sm"
      primaryAction={{
        label: "Save split",
        onClick: () => {
          onConfirm(pct);
          onOpenChange(false);
        },
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="divorce-split-pct" className={fieldLabelClassName}>
            <span className="inline-flex items-center gap-1.5">
              Share to {spouseName}
              <FieldTooltip
                text={`Percent of this asset's value and cost basis assigned to ${spouseName}; the remainder stays with ${primaryName}.`}
              />
            </span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={99}
              step={1}
              value={pct}
              aria-label={`Share to ${spouseName}`}
              onChange={(e) => setPct(clampPct(Number(e.target.value)))}
              className="h-1 flex-1 cursor-pointer"
              style={{ accentColor: "var(--color-accent)" }}
            />
            <div className="flex items-center gap-1">
              <input
                id="divorce-split-pct"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={pct}
                onChange={(e) => setPct(clampPct(Number(e.target.value)))}
                className={`${inputBaseClassName} w-16 text-right tabular`}
              />
              <span className="tabular text-[13px] text-ink-3">%</span>
            </div>
          </div>
        </div>

        {/* Live two-sided preview — value + basis per side via splitAmounts. */}
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-hair">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hair">
                <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-4" />
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  {primaryName}
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  {spouseName}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hair">
                <td className="px-3 py-2 text-ink-3">Value</td>
                <td className="px-3 py-2 text-right tabular text-ink">
                  {currency.format(shares.primary.value)}
                </td>
                <td className="px-3 py-2 text-right tabular text-ink">
                  {currency.format(shares.spouse.value)}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-ink-3">Cost basis</td>
                <td className="px-3 py-2 text-right tabular text-ink-2">
                  {currency.format(shares.primary.basis)}
                </td>
                <td className="px-3 py-2 text-right tabular text-ink-2">
                  {currency.format(shares.spouse.basis)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DialogShell>
  );
}
