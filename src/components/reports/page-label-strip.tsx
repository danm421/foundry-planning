// src/components/reports/page-label-strip.tsx
//
// Thin label rendered above each page in the canvas. Shows
// `P01 · PORTRAIT` (etc) on the left and rotate / duplicate / delete
// buttons on the right. Delete prompts for confirmation when the page
// has any rows; empty pages delete without confirm.

"use client";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";

export function PageLabelStrip({
  page,
  index,
  dispatch,
}: {
  page: Page;
  index: number;
  dispatch: React.Dispatch<Action>;
}) {
  const label = `P${String(index + 1).padStart(2, "0")} · ${page.orientation.toUpperCase()}`;
  return (
    <div className="flex items-center justify-between text-[11px] font-mono text-ink-3 mb-2">
      <span>{label}</span>
      <span className="flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "TOGGLE_PAGE_ORIENTATION", pageId: page.id });
          }}
          className="hover:text-ink"
        >
          ⤾ rotate
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "DUPLICATE_PAGE", pageId: page.id });
          }}
          className="hover:text-ink"
        >
          ⎘ dup
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (page.rows.length && !window.confirm("Delete this page and its contents?")) return;
            dispatch({ type: "DELETE_PAGE", pageId: page.id });
          }}
          className="text-crit hover:opacity-80"
        >
          × del
        </button>
      </span>
    </div>
  );
}
