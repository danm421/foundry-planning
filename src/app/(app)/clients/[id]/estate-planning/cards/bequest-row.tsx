"use client";

import type { BequestSummaryRow } from "../lib/derive-card-data";

export function BequestRow({
  bequest,
  onEdit,
  subLine,
}: {
  bequest: BequestSummaryRow;
  onEdit: (ref: { willId: string; bequestId: string }) => void;
  subLine?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit({ willId: bequest.willId, bequestId: bequest.bequestId })}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-ink)]"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate">{bequest.assetName}</span>
            {bequest.condition !== "always" && (
              <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-ink-3)]">
                {bequest.condition}
              </span>
            )}
          </div>
          {subLine && (
            <div className="text-[10px] text-[var(--color-ink-3)] mt-0.5">{subLine}</div>
          )}
        </div>
        <span className="tabular-nums shrink-0">{bequest.percentage}%</span>
      </button>
    </li>
  );
}
