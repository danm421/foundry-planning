"use client";

import { useState } from "react";
import type { RowDiff } from "@/lib/scenario/diff-row";

export function DetailsRowGutter({
  diff,
  onRevert,
}: {
  diff: RowDiff;
  onRevert: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (diff.kind === "unchanged") return <span className="inline-block w-3" aria-hidden />;

  const dot =
    diff.kind === "add" ? (
      <span className="text-good" aria-label="added">
        +
      </span>
    ) : diff.kind === "remove" ? (
      <span className="text-crit line-through" aria-label="removed">
        −
      </span>
    ) : (
      <span className="text-accent-ink" aria-label="edited">
        Δ
      </span>
    );

  return (
    <span
      className="relative inline-block w-3 cursor-pointer font-mono text-[12px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
    >
      {dot}
      {hovered && (
        <div
          role="tooltip"
          className="absolute z-20 left-5 top-0 w-[280px] bg-card border border-hair rounded p-3 text-[12px] shadow-lg"
        >
          {diff.kind === "edit" && (
            <div className="space-y-1">
              {diff.fields.map((f) => (
                <div key={f.field} className="text-ink-3">
                  <span className="text-ink-4">{f.field}:</span>{" "}
                  <span>Base {String(f.from)}</span>
                  {" → "}
                  <span className="text-ink">Scenario {String(f.to)}</span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onRevert}
            className="mt-2 text-[11px] text-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-1"
          >
            ↶ Revert
          </button>
        </div>
      )}
    </span>
  );
}
