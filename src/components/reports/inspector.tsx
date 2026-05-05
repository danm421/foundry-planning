// src/components/reports/inspector.tsx
//
// Right pane of the builder. Interim implementation for Task 8 — Task 11
// wires the per-widget editors. The `pages` and `dispatch` props are
// declared on the type signature now (rather than added later) so that
// Task 11's full implementation does not change the public API.

"use client";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";

export function Inspector(props: {
  pages: Page[];
  selectedWidgetId: string | null;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <aside className="w-[320px] border-l border-hair bg-card overflow-y-auto">
      <div className="p-4 text-[12px] font-mono text-ink-3 uppercase tracking-wider">
        Inspector
      </div>
      {props.selectedWidgetId === null ? (
        <div className="px-4 text-[13px] text-ink-3">
          No selection. Click a block to edit, or drag from the library.
        </div>
      ) : (
        <div className="px-4 text-[13px] text-ink-3">
          (widget editors register in Task 11+)
        </div>
      )}
    </aside>
  );
}
