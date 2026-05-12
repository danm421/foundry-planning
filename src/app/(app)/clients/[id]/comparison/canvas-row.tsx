"use client";

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
}: Props) {
  const widthBadge = WIDTH_BADGE[row.cells.length] ?? "?";
  const atMax = row.cells.length >= 5;

  return (
    <div
      data-canvas-row={row.id}
      className="group/row relative flex flex-col gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-slate-800"
    >
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
  );
}
