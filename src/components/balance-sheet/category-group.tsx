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
    <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-900/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between bg-gray-800/60 px-3 py-2 text-left hover:bg-gray-800 ${expanded ? "border-b border-gray-700" : ""}`}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">{label}</span>
          {tag && (
            <span className="rounded border border-amber-900/40 bg-amber-900/20 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-300">
              {tag}
            </span>
          )}
        </span>
        <span className="text-xs font-medium text-gray-300">{total}</span>
      </button>
      {expanded && <div className="divide-y divide-gray-800">{children}</div>}
    </div>
  );
}

export default CategoryGroup;
