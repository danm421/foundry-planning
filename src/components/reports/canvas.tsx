// src/components/reports/canvas.tsx
//
// Center pane of the builder. Renders pages → rows → slots, resolving
// each widget via the registry. `data` is null for now; Task 13/14 wires
// per-widget fetchers and feeds real values through. Selection is driven
// by click handlers that stop propagation so the bare-canvas click can
// clear the selection.
//
// Each slot is a @dnd-kit drop target via the local Slot subcomponent.
// Legality dimming during drag is wired structurally but currently
// receives `draggingKind={null}` — Task 17 wires the active drag source.

"use client";
import { useDroppable } from "@dnd-kit/core";
import type { Page, RowSize, Widget } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { getWidget } from "@/lib/reports/widget-registry";

function Slot({ pageId, rowId, slotIndex, rowLayout, widget, selected, onSelect, draggingKind }: {
  pageId: string; rowId: string; slotIndex: number; rowLayout: RowSize;
  widget: Widget | null; selected: boolean; onSelect: () => void;
  draggingKind: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${pageId}-${rowId}-${slotIndex}`,
    data: { kind: "slot", pageId, rowId, slotIndex },
  });
  const legal = !draggingKind || getWidget(draggingKind as never).allowedRowSizes.includes(rowLayout);
  const ringClass = isOver && legal ? "ring-2 ring-accent ring-offset-2" :
                    !legal ? "opacity-30" : "";
  return (
    <div ref={setNodeRef} className={`rounded-sm transition ${ringClass}`}>
      {widget === null ? (
        <div className="border border-dashed border-hair rounded-sm h-24 text-ink-3 text-[11px] flex items-center justify-center">empty slot</div>
      ) : (
        <div onClick={(e) => { e.stopPropagation(); onSelect(); }}
             className={selected ? "ring-2 ring-accent rounded-sm" : ""}>
          {(() => {
            const entry = getWidget(widget.kind);
            const Render = entry.Render;
            return <Render props={widget.props as never} data={null} mode="screen" widgetId={widget.id} />;
          })()}
        </div>
      )}
    </div>
  );
}

export function Canvas({
  pages, dispatch, selectedWidgetId, onSelectWidget,
}: {
  pages: Page[];
  dispatch: React.Dispatch<Action>;
  selectedWidgetId: string | null;
  onSelectWidget: (id: string | null) => void;
}) {
  return (
    <main className="flex-1 overflow-y-auto bg-paper px-8 py-6" onClick={() => onSelectWidget(null)}>
      <div className="max-w-[8.5in] mx-auto space-y-6">
        {pages.map((p) => (
          <div key={p.id} className="bg-card border border-hair rounded-sm p-12 space-y-4">
            {p.rows.map((r) => (
              <div key={r.id} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${r.slots.length}, minmax(0, 1fr))` }}>
                {r.slots.map((w, i) => (
                  <Slot
                    key={w?.id ?? `${r.id}-${i}`}
                    pageId={p.id}
                    rowId={r.id}
                    slotIndex={i}
                    rowLayout={r.layout}
                    widget={w}
                    selected={w !== null && selectedWidgetId === w.id}
                    onSelect={() => onSelectWidget(w!.id)}
                    draggingKind={null}
                  />
                ))}
              </div>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); dispatch({ type: "ADD_ROW", pageId: p.id, layout: "2-up" }); }}
              className="text-[12px] font-mono text-ink-3 hover:text-ink"
            >+ Add 2-up row</button>
          </div>
        ))}
        <button
          onClick={(e) => { e.stopPropagation(); dispatch({ type: "ADD_PAGE", orientation: "portrait" }); }}
          className="block mx-auto text-[12px] font-mono text-ink-3 hover:text-ink"
        >+ portrait page</button>
      </div>
    </main>
  );
}
