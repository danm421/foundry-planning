"use client";

import { useState } from "react";
import { clampToViewport } from "./clamp-to-viewport";

interface Props {
  anchor: { clientX: number; clientY: number };
  assetName: string;
  trustName: string;
  defaultStartYear: number;
  defaultEndYear: number;
  onConfirm: (input: {
    startYear: number;
    endYear: number;
    annualAmount: number;
    inflationAdjust: boolean;
  }) => void | Promise<void>;
  onCancel: () => void;
}

export function RecurringSeriesPopover({
  anchor,
  assetName,
  trustName,
  defaultStartYear,
  defaultEndYear,
  onConfirm,
  onCancel,
}: Props) {
  const [startYear, setStartYear] = useState(defaultStartYear);
  const [endYear, setEndYear] = useState(defaultEndYear);
  const [amount, setAmount] = useState(18_000);
  const [adjust, setAdjust] = useState(false);
  const ok = endYear >= startYear && amount > 0;
  const { left, top } = clampToViewport(anchor, 320, 280);
  return (
    <div role="dialog" aria-label="Recurring annual gift" className="fixed inset-0 z-50">
      <button
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div
        style={{ left, top }}
        className="absolute w-[300px] rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] p-3 shadow-xl"
      >
        <p className="mb-3 text-xs text-[var(--color-ink-2)]">
          Recurring gift from{" "}
          <span className="font-medium text-[var(--color-ink)]">{assetName}</span>
          {" → "}
          <span className="font-medium text-[var(--color-ink)]">{trustName}</span>
        </p>
        <Field label="Start year">
          <input
            type="number"
            min={1900}
            max={2200}
            value={startYear}
            onChange={(e) => setStartYear(parseInt(e.target.value, 10) || defaultStartYear)}
            className="w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card-2)] px-2 py-1 text-sm text-[var(--color-ink)]"
          />
        </Field>
        <Field label="End year">
          <input
            type="number"
            min={1900}
            max={2200}
            value={endYear}
            onChange={(e) => setEndYear(parseInt(e.target.value, 10) || defaultEndYear)}
            className="w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card-2)] px-2 py-1 text-sm text-[var(--color-ink)]"
          />
        </Field>
        <Field label="Annual amount">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card-2)] px-2 py-1 text-sm text-[var(--color-ink)]"
          />
        </Field>
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
          <input
            type="checkbox"
            checked={adjust}
            onChange={(e) => setAdjust(e.target.checked)}
          />
          Inflation-adjust
        </label>
        <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
          Materializes {Math.max(0, endYear - startYear + 1)} gift rows.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-hair-2)] px-3 py-1 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-card-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() =>
              onConfirm({ startYear, endYear, annualAmount: amount, inflationAdjust: adjust })
            }
            className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-paper)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block text-xs text-[var(--color-ink-3)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
