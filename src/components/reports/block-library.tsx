// src/components/reports/block-library.tsx
//
// Left pane of the builder. Stub for Task 8 — Task 12 fleshes out the
// full draggable widget catalog.

"use client";

export function BlockLibrary() {
  return (
    <aside className="w-[300px] border-r border-hair bg-card overflow-y-auto">
      <div className="p-4 text-[12px] font-mono text-ink-3 uppercase tracking-wider">
        Block library
      </div>
      <div className="px-4 text-[13px] text-ink-3">
        (widget cards will appear here once registered)
      </div>
    </aside>
  );
}
