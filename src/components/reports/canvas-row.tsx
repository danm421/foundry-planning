// src/components/reports/canvas-row.tsx
//
// A single row inside a canvas page. Renders a hover-revealed control
// strip above the row (drag handle, layout pills, +above/+below, delete)
// and the row's slots as drop targets via the private `CanvasSlot`
// subcomponent. Cross-row drag-to-reorder is supported by the `RowGap`
// droppable, which `Canvas` interleaves above each row and after the
// last row in a page.
//
// Cross-page row drag is intentionally out of scope for v1 — the spec
// defers that to Cut/Paste (§3).

"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Page, Row, RowSize, Widget } from "@/lib/reports/types";
import { SLOT_COUNT_BY_LAYOUT } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { getWidget } from "@/lib/reports/widget-registry";

const LAYOUT_OPTIONS: RowSize[] = ["1-up", "2-up", "3-up", "4-up"];

function CanvasSlot({ pageId, rowId, slotIndex, widget, selected, onSelect }: {
  pageId: string; rowId: string; slotIndex: number;
  // rowLayout is reserved for Task 17's legality dimming
  // (`getWidget(draggingKind).allowedRowSizes.includes(rowLayout)`); kept on the
  // prop type so callers and types stay stable when that work lands.
  rowLayout: RowSize;
  widget: Widget | null; selected: boolean; onSelect: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${pageId}-${rowId}-${slotIndex}`,
    data: { kind: "slot", pageId, rowId, slotIndex },
  });
  const ringClass = isOver ? "ring-2 ring-accent ring-offset-2" : "";
  return (
    <div ref={setNodeRef} className={`rounded-sm transition ${ringClass}`}>
      {widget === null ? (
        <div className="border border-dashed border-hair rounded-sm h-24 text-ink-3 text-[11px] flex items-center justify-center">empty</div>
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

export function RowGap({ pageId, index }: { pageId: string; index: number }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `row-gap-${pageId}-${index}`,
    data: { kind: "row-drop", pageId, index },
  });
  return (
    <div ref={setNodeRef} className={`h-2 -my-1 transition ${isOver ? "bg-accent/30 rounded-sm" : ""}`} />
  );
}

export function CanvasRow({
  row, page, rowIndex, dispatch, selectedWidgetId, onSelectWidget,
}: {
  row: Row;
  page: Page;
  rowIndex: number;
  dispatch: React.Dispatch<Action>;
  selectedWidgetId: string | null;
  onSelectWidget: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `row-${row.id}`,
    data: { source: "row", pageId: page.id, rowId: row.id, rowIndex },
  });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const isOccupied = row.slots.some((s) => s !== null);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOccupied && !window.confirm("Delete this row and its widgets?")) return;
    dispatch({ type: "DELETE_ROW", pageId: page.id, rowId: row.id });
  };

  return (
    <div ref={setNodeRef} style={style} className={`group relative ${isDragging ? "opacity-50" : ""}`}>
      {/* Hover control strip */}
      <div className="absolute -top-7 left-0 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          {...listeners} {...attributes}
          className="text-[10px] font-mono text-ink-3 hover:text-ink cursor-grab active:cursor-grabbing px-1"
          aria-label="Drag to reorder row"
        >⋮⋮</button>
        <div className="inline-flex bg-card-2 border border-hair rounded-sm p-0.5">
          {LAYOUT_OPTIONS.map((l) => (
            <button key={l}
              onClick={(e) => { e.stopPropagation(); dispatch({ type: "UPDATE_ROW_LAYOUT", pageId: page.id, rowId: row.id, layout: l }); }}
              className={`h-5 px-2 text-[10px] font-mono ${l === row.layout ? "bg-card text-ink" : "text-ink-3"}`}>
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "ADD_ROW", pageId: page.id, index: rowIndex, layout: "2-up" });
          }}
          className="text-[10px] font-mono text-ink-3 hover:text-ink ml-2 px-1"
        >+ above</button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: "ADD_ROW", pageId: page.id, index: rowIndex + 1, layout: "2-up" });
          }}
          className="text-[10px] font-mono text-ink-3 hover:text-ink px-1"
        >+ below</button>
        <button
          onClick={handleDelete}
          className="text-[10px] font-mono text-crit hover:opacity-80 ml-auto px-1"
        >delete row</button>
      </div>
      {/* The row body */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${SLOT_COUNT_BY_LAYOUT[row.layout]}, minmax(0, 1fr))` }}>
        {row.slots.map((w, i) => (
          <CanvasSlot
            key={w?.id ?? `${row.id}-${i}`}
            pageId={page.id}
            rowId={row.id}
            slotIndex={i}
            rowLayout={row.layout}
            widget={w}
            selected={!!w && w.id === selectedWidgetId}
            onSelect={() => w && onSelectWidget(w.id)}
          />
        ))}
      </div>
    </div>
  );
}
