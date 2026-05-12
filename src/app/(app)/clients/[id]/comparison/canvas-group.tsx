"use client";

import { useEffect, useRef } from "react";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CellSpan, Group, WidgetInstance } from "@/lib/comparison/layout-schema";
import { CanvasCell, type ScenarioLookup } from "./canvas-cell";

interface Props {
  group: Group;
  scenarios: ScenarioLookup[];
  autoFocusTitle?: boolean;
  onSetTitle: (title: string) => void;
  onRemoveGroup: () => void;
  onAddWidget: (cellId: string) => void;
  onEditWidget: (cellId: string) => void;
  onRemoveCell: (cellId: string) => void;
  onDuplicateCell: (cellId: string) => void;
  onAddRight: (cellId: string) => void;
  onAddDown: (cellId: string) => void;
  onChangeSpan: (cellId: string, span: CellSpan) => void;
  onSetCellWidget?: (cellId: string, widget: WidgetInstance) => void;
}

export function CanvasGroup({
  group,
  scenarios,
  autoFocusTitle,
  onSetTitle,
  onRemoveGroup,
  onAddWidget,
  onEditWidget,
  onRemoveCell,
  onDuplicateCell,
  onAddRight,
  onAddDown,
  onChangeSpan,
  onSetCellWidget,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    data: { type: "group" },
  });
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!autoFocusTitle) return;
    const el = titleInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [autoFocusTitle]);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const hasAnyWidget = group.cells.some((c) => c.widget !== null);
  const handleDelete = () => {
    if (hasAnyWidget && !window.confirm("Delete this group and its widgets?")) return;
    onRemoveGroup();
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      data-canvas-group={group.id}
      className="group/group relative flex flex-col gap-2 rounded-lg border border-transparent p-2 hover:border-slate-800"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Drag group"
          data-drag-handle="group"
          className="cursor-grab text-ink-3 hover:text-slate-200"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <input
          ref={titleInputRef}
          type="text"
          aria-label="Group title"
          value={group.title}
          onChange={(e) => onSetTitle(e.target.value)}
          placeholder="Untitled group"
          className="flex-1 bg-transparent text-base font-medium text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Delete group"
          onClick={handleDelete}
          className="rounded px-2 py-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-800 hover:text-slate-200 group-hover/group:opacity-100"
        >
          Delete group
        </button>
      </div>

      <SortableContext items={group.cells.map((c) => c.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-5 gap-2">
          {group.cells.map((cell) => (
            <CanvasCell
              key={cell.id}
              cell={cell}
              groupId={group.id}
              scenarios={scenarios}
              onAddWidget={() => onAddWidget(cell.id)}
              onEditWidget={() => onEditWidget(cell.id)}
              onRemove={() => onRemoveCell(cell.id)}
              onDuplicate={() => onDuplicateCell(cell.id)}
              onAddRight={() => onAddRight(cell.id)}
              onAddDown={() => onAddDown(cell.id)}
              onChangeSpan={(span) => onChangeSpan(cell.id, span)}
              onSetWidget={onSetCellWidget ? (widget) => onSetCellWidget(cell.id, widget) : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}
