"use client";

import { ChevronDown, ChevronRight } from "./icons";

function CategoryGroup({
  label,
  tag,
  total,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  /** Optional amber annotation next to the label (e.g. "Out of estate" on
   *  the 529 group — listed here for visibility but not in the card total). */
  tag?: string;
  total: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-hair bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between bg-card-2 px-3 py-2 text-left hover:bg-card-hover ${expanded ? "border-b border-hair" : ""}`}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-3">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-2">{label}</span>
          {tag && (
            <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-warn">
              {tag}
            </span>
          )}
        </span>
        <span className="text-xs font-medium text-ink-3">{total}</span>
      </button>
      {expanded && <div className="divide-y divide-hair">{children}</div>}
    </div>
  );
}

export default CategoryGroup;
