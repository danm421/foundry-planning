"use client";

import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Row } from "@/lib/comparison/layout-schema";
import type { ScenarioLookup } from "./widget-card";
import { CanvasCell } from "./canvas-cell";

const WIDTH_BADGE: Record<number, string> = {
  1: "full",
  2: "½",
  3: "⅓",
  4: "¼",
  5: "⅕",
};

interface Props {
  row: Row;
  scenarios: ScenarioLookup[];
  onEditCell: (cellId: string) => void;
  onRemoveCell: (rowId: string, cellId: string) => void;
  onAddCell: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onDuplicateCell: (rowId: string, cellId: string) => void;
  onMoveCellLeft: (rowId: string, cellId: string) => void;
  onMoveCellRight: (rowId: string, cellId: string) => void;
  onMoveUp: (rowId: string) => void;
  onMoveDown: (rowId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function CanvasRow({
  row,
  scenarios,
  onEditCell,
  onRemoveCell,
  onAddCell,
  onDeleteRow,
  onDuplicateCell,
  onMoveCellLeft,
  onMoveCellRight,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: Props) {
  const widthBadge = WIDTH_BADGE[row.cells.length] ?? "?";
  const atMax = row.cells.length >= 5;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { type: "row" },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-canvas-row={row.id}
      className="group/row relative flex gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-slate-800"
    >
      <div className="flex shrink-0 flex-col items-center gap-1 pt-2 text-slate-400">
        <button
          type="button"
          data-drag-handle="row"
          aria-label="Drag row"
          className="cursor-grab hover:text-slate-200"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          aria-label="Move row up"
          onClick={() => onMoveUp(row.id)}
          disabled={!canMoveUp}
          className="rounded px-1 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Move row down"
          onClick={() => onMoveDown(row.id)}
          disabled={!canMoveDown}
          className="rounded px-1 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
        >
          ↓
        </button>
      </div>

      <div className="flex-1">
        <SortableContext items={row.cells.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-stretch gap-2">
            {row.cells.map((cell, idx) => (
              <CanvasCell
                key={cell.id}
                cell={cell}
                rowId={row.id}
                widthBadge={widthBadge}
                scenarios={scenarios}
                onEdit={() => onEditCell(cell.id)}
                onRemove={() => onRemoveCell(row.id, cell.id)}
                onDuplicate={() => onDuplicateCell(row.id, cell.id)}
                onMoveLeft={() => onMoveCellLeft(row.id, cell.id)}
                onMoveRight={() => onMoveCellRight(row.id, cell.id)}
                canMoveLeft={idx > 0}
                canMoveRight={idx < row.cells.length - 1}
              />
            ))}
          </div>
        </SortableContext>

        <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover/row:opacity-100">
          <button
            type="button"
            aria-label="Add cell"
            onClick={() => onAddCell(row.id)}
            disabled={atMax}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            + Cell
          </button>
          <button
            type="button"
            aria-label="Delete row"
            onClick={() => onDeleteRow(row.id)}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            Delete row
          </button>
        </div>
      </div>
    </div>
  );
}
