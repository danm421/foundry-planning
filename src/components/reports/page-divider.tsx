// src/components/reports/page-divider.tsx
//
// `+ PORTRAIT / + LANDSCAPE` button pair rendered between pages and
// below the last page (and before the first page, to handle the
// no-pages case). Dispatches `ADD_PAGE` with `afterPageId` so the
// reducer inserts the new page at the correct position.

"use client";
import type { Action } from "@/lib/reports/reducer";

export function PageDivider({
  afterPageId,
  dispatch,
}: {
  afterPageId?: string;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div className="flex justify-center gap-2 my-4">
      <button
        onClick={() => dispatch({ type: "ADD_PAGE", orientation: "portrait", afterPageId })}
        className="text-[11px] font-mono text-ink-3 hover:text-ink border border-hair rounded px-3 py-1"
      >
        + PORTRAIT
      </button>
      <button
        onClick={() => dispatch({ type: "ADD_PAGE", orientation: "landscape", afterPageId })}
        className="text-[11px] font-mono text-ink-3 hover:text-ink border border-hair rounded px-3 py-1"
      >
        + LANDSCAPE
      </button>
    </div>
  );
}
