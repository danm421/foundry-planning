"use client";

import type { ReactNode } from "react";

/** Horizontal container for a page's option groups. Groups wrap on narrow
 *  widths. Replaces the old vertical `space-y-3` root used in every control. */
export function OptionsRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-ink-2">
      {children}
    </div>
  );
}

/** A single labeled cluster of related inputs, stacked vertically inside the
 *  horizontal row. `label` renders as the standard small-caps legend. */
export function OptionsGroup({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {label != null && (
        <div className="text-[11px] uppercase tracking-[0.1em] text-ink-3">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
