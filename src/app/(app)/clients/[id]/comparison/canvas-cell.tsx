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
}

export function CanvasCell({ cell, rowId, widthBadge, scenarios, onEdit, onRemove }: Props) {
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
      />
    </div>
  );
}
