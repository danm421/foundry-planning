// src/components/reports/canvas.tsx
//
// Center pane of the builder. Interim implementation for Task 8 —
// Task 11 replaces this with full widget rendering. For now it renders
// either an empty-state CTA or one tile per page.

"use client";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";

export function Canvas(props: {
  pages: Page[];
  dispatch: React.Dispatch<Action>;
  selectedWidgetId: string | null;
  onSelectWidget: (id: string | null) => void;
}) {
  const { pages, dispatch, onSelectWidget } = props;
  return (
    <main
      className="flex-1 overflow-y-auto bg-paper px-8 py-6"
      onClick={() => onSelectWidget(null)}
    >
      {pages.length === 0 ? (
        <div className="border border-hair rounded-md p-12 text-center text-ink-3 max-w-2xl mx-auto">
          <div>This report is empty.</div>
          <button
            className="mt-4 h-9 px-4 rounded-md bg-card-2 border border-hair text-ink hover:border-ink-3"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "ADD_PAGE", orientation: "portrait" });
            }}
          >
            + Add portrait page
          </button>
        </div>
      ) : (
        <div className="space-y-6 max-w-[8.5in] mx-auto">
          {pages.map((p) => (
            <div
              key={p.id}
              className="bg-card border border-hair rounded-sm aspect-[8.5/11] p-12 text-ink-3 text-[12px]"
            >
              page {p.id.slice(0, 8)} · {p.orientation}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
