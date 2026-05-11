"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  ComparisonLayout,
  ComparisonLayoutItem,
  ComparisonWidgetKind,
} from "@/lib/comparison/layout-schema";
import { WIDGET_KINDS } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import type { UseLayoutApi } from "./use-layout";

interface Props {
  layout: ComparisonLayout;
  api: UseLayoutApi;
  onDone: () => void;
}

function textPreview(item: ComparisonLayoutItem): string {
  if (item.kind !== "text") return COMPARISON_WIDGETS[item.kind].title;
  const md = (item.config as { markdown?: string } | undefined)?.markdown ?? "";
  const firstLine = md.split("\n").find((l) => l.trim() !== "") ?? "";
  if (!firstLine) return "Text block (empty)";
  const clean = firstLine.replace(/^#+\s*/, "").replace(/\*+/g, "");
  return clean.length > 40 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}

function LayoutRow({
  item,
  onRemove,
}: {
  item: ComparisonLayoutItem;
  onRemove: (id: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: item.instanceId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-layout-row={item.instanceId}
      className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-sm text-slate-200"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab text-slate-500 hover:text-slate-300"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="flex-1 truncate">{textPreview(item)}</span>
      <button
        type="button"
        aria-label="Remove widget"
        data-action="remove"
        className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        onClick={() => onRemove(item.instanceId)}
      >
        ×
      </button>
    </div>
  );
}

function InsertTextSlot({
  index,
  onInsert,
}: {
  index: number;
  onInsert: (i: number) => void;
}) {
  return (
    <button
      type="button"
      data-insert-text-at={index}
      onClick={() => onInsert(index)}
      className="block w-full px-3 py-0.5 text-left text-[11px] text-slate-600 opacity-0 transition-opacity hover:text-slate-200 hover:opacity-100 focus-visible:opacity-100"
    >
      + Insert text
    </button>
  );
}

function AvailableRow({
  kind,
  onAdd,
}: {
  kind: ComparisonWidgetKind;
  onAdd: (kind: ComparisonWidgetKind) => void;
}) {
  const def = COMPARISON_WIDGETS[kind];
  return (
    <button
      type="button"
      data-available-kind={kind}
      onClick={() => onAdd(kind)}
      className="flex w-full items-center gap-2 border-b border-slate-800 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
    >
      <span className="text-slate-500">+</span>
      <span className="flex-1 truncate">{def.title}</span>
    </button>
  );
}

export function WidgetPanel({ layout, api, onDone }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = layout.items.findIndex((i) => i.instanceId === active.id);
    const toIndex = layout.items.findIndex((i) => i.instanceId === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    api.move(fromIndex, toIndex);
  };

  const usedKinds = new Set(layout.items.map((i) => i.kind));
  const available: ComparisonWidgetKind[] = WIDGET_KINDS.filter(
    (k) => k !== "text" && !usedKinds.has(k),
  );

  const handleReset = () => {
    if (window.confirm("Replace the current layout with the default? This cannot be undone.")) {
      api.reset();
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="Widget panel"
      className="fixed right-0 top-14 z-40 flex w-[360px] flex-col border-l border-slate-800 bg-slate-950 shadow-xl"
      style={{ height: "calc(100vh - 3.5rem)" }}
    >
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-sm font-medium text-slate-200">Widgets</span>
        <button
          type="button"
          onClick={onDone}
          disabled={api.saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-slate-950 disabled:opacity-60"
        >
          {api.saving ? "Saving…" : "Done"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section>
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Layout ({layout.items.length})
          </div>
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={layout.items.map((i) => i.instanceId)}
              strategy={verticalListSortingStrategy}
            >
              <InsertTextSlot index={0} onInsert={api.insertTextAt} />
              {layout.items.map((item, i) => (
                <div key={item.instanceId}>
                  <LayoutRow item={item} onRemove={api.remove} />
                  <InsertTextSlot index={i + 1} onInsert={api.insertTextAt} />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        </section>

        <section className="mt-2 border-t border-slate-800">
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Available ({available.length})
          </div>
          {available.length === 0 ? (
            <div className="px-3 py-3 text-xs italic text-slate-500">
              Every widget is already in your layout.
            </div>
          ) : (
            available.map((kind) => (
              <AvailableRow key={kind} kind={kind} onAdd={api.add} />
            ))
          )}
        </section>
      </div>

      <footer className="border-t border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          Reset to default
        </button>
      </footer>
    </aside>
  );
}
