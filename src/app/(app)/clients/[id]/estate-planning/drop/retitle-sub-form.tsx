"use client";

import { useState } from "react";
import type { Recipient } from "./lib/save-handlers";

export interface RetitleSubFormProps {
  /** Owner's stake in the asset (fraction 0-1) — informational only. */
  ownerSlicePct: number;
  /** 'entity' | 'family_member' (charity is excluded by the parent chooser). */
  recipientKind: Recipient["kind"];
  onSubmit: (payload: { sliceFraction: number }) => void;
  onCancel: () => void;
}

const INPUT_CLASS =
  "block w-full rounded-md border border-[var(--color-hair-2)] bg-[var(--color-card)] px-2 py-1 text-sm text-[var(--color-ink)] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function RetitleSubForm({ onSubmit, onCancel }: RetitleSubFormProps) {
  const [percent, setPercent] = useState(100);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fraction = percent / 100;
    // Browser min/max may not enforce in JSDOM — validate explicitly.
    if (!(fraction > 0) || fraction > 1) return; // audit finding #6
    onSubmit({ sliceFraction: fraction });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 p-3 text-sm text-[var(--color-ink)]"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="retitle-percent" className="text-xs text-[var(--color-ink-3)]">
          Percent of owner&rsquo;s slice to retitle
        </label>
        <input
          id="retitle-percent"
          type="number"
          min={0.01}
          max={100}
          step={0.01}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className={INPUT_CLASS}
        />
      </div>

      <p className="text-xs text-[var(--color-ink-3)]">
        No gift event recorded. No exemption consumed. Use this to record current
        ownership state.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-xs text-[var(--color-ink-3)] hover:bg-[var(--color-card-hover)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          Save
        </button>
      </div>
    </form>
  );
}
