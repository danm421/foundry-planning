"use client";

import type { Cell } from "@/lib/comparison/layout-schema";
import { WidgetCard, type ScenarioLookup } from "./widget-card";

interface Props {
  cell: Cell;
  rowId: string;
  widthBadge: string;
  scenarios: ScenarioLookup[];
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}

export function CanvasCell({
  cell,
  rowId,
  widthBadge,
  scenarios,
  onEdit,
  onRemove,
  onDuplicate,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
}: Props) {
  return (
    <div
      data-canvas-cell={cell.id}
      data-canvas-row={rowId}
      className="flex-1 min-w-0"
    >
      <WidgetCard
        widget={cell.widget}
        widthBadge={widthBadge}
        scenarios={scenarios}
        onEdit={onEdit}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
        canMoveLeft={canMoveLeft}
        canMoveRight={canMoveRight}
      />
    </div>
  );
}
