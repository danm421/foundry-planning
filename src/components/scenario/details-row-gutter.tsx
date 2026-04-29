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
      <span className="text-[#7fa97f]" aria-label="added">
        +
      </span>
    ) : diff.kind === "remove" ? (
      <span className="text-[#c87a7a] line-through" aria-label="removed">
        −
      </span>
    ) : (
      <span className="text-[#d4a04a]" aria-label="edited">
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
          className="absolute z-20 left-5 top-0 w-[280px] bg-[#101114] border border-ink-4 rounded p-3 text-[12px] shadow-lg"
        >
          {diff.kind === "edit" && (
            <div className="space-y-1">
              {diff.fields.map((f) => (
                <div key={f.field} className="text-[#a09c92]">
                  <span className="text-[#6b6760]">{f.field}:</span>{" "}
                  <span>Base {String(f.from)}</span>
                  {" → "}
                  <span className="text-[#e7e6e2]">Scenario {String(f.to)}</span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onRevert}
            className="mt-2 text-[11px] text-[#7a5b29] hover:text-[#d4a04a] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a04a] rounded px-1"
          >
            ↶ Revert
          </button>
        </div>
      )}
    </span>
  );
}
