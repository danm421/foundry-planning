"use client";

import { useState } from "react";
import { clampToViewport } from "./clamp-to-viewport";

interface Props {
  anchor: { clientX: number; clientY: number };
  assetName: string;
  totalValue: number;
  clientLabel: string;
  spouseLabel: string;
  onConfirm: (clientShare: number) => void | Promise<void>;
  onCancel: () => void;
}

export function AllocateConfirm({
  anchor,
  assetName,
  totalValue,
  clientLabel,
  spouseLabel,
  onConfirm,
  onCancel,
}: Props) {
  const [pct, setPct] = useState(50);

  const { left, top } = clampToViewport(anchor, 320, 220);

  const fmt = (v: number) =>
    v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div role="dialog" aria-label={`Allocate ${assetName}`} className="fixed inset-0 z-50">
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
          Allocate{" "}
          <span className="font-medium text-[var(--color-ink)]">{assetName}</span>
          {" ("}
          <span className="tabular-nums">{fmt(totalValue)}</span>
          {") "}before moving.
        </p>

        <label className="block text-xs text-[var(--color-ink-3)]">
          {clientLabel}:{" "}
          <span className="tabular-nums text-[var(--color-ink)]">{pct}%</span>
        </label>
        <input
          type="range"
          min={1}
          max={99}
          value={pct}
          onChange={(e) => setPct(parseInt(e.target.value, 10))}
          className="mt-1 w-full"
        />
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          {spouseLabel}:{" "}
          <span className="tabular-nums text-[var(--color-ink)]">{100 - pct}%</span>
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs tabular-nums text-[var(--color-ink-2)]">
          <span>
            {clientLabel}: {fmt((totalValue * pct) / 100)}
          </span>
          <span>
            {spouseLabel}: {fmt((totalValue * (100 - pct)) / 100)}
          </span>
        </div>

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
            onClick={() => onConfirm(pct / 100)}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-paper)]"
          >
            Allocate
          </button>
        </div>
      </div>
    </div>
  );
}
