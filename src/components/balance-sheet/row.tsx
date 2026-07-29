"use client";

import type { ReactNode } from "react";
import { TrashIcon } from "./icons";
import { PencilIcon } from "@/components/icons";

function Row({
  onClick,
  editMode,
  onDelete,
  onEdit,
  deletable = true,
  label,
  labelBadge,
  subLabel,
  value,
  valueClassName,
  ownerSlot,
  rateSlot,
  valueSlot,
}: {
  onClick?: () => void;
  editMode: boolean;
  onDelete?: () => void;
  /** Opens the full editor. Rendered as a pencil — the only way in once the
   *  row carries inline controls, since a row-level click fights them. */
  onEdit?: () => void;
  deletable?: boolean;
  label: string;
  labelBadge?: ReactNode;
  subLabel?: string;
  value: string;
  valueClassName?: string;
  ownerSlot?: ReactNode;
  rateSlot?: ReactNode;
  valueSlot?: ReactNode;
}) {
  // A row-level handler swallows clicks meant for the controls inside it, so a
  // row that has any inline cell gives up its own click entirely.
  const hasInlineSlots = Boolean(ownerSlot || rateSlot || valueSlot);
  const rowClickable = !hasInlineSlots && onClick;

  return (
    <div
      onClick={hasInlineSlots ? undefined : onClick}
      data-row-clickable={rowClickable ? "true" : undefined}
      className={`flex items-center justify-between px-4 py-2 ${rowClickable ? "cursor-pointer hover:bg-gray-800/60" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-100">
          <span className="truncate">{label}</span>
          {labelBadge}
        </div>
        {subLabel && <div className="truncate text-xs text-gray-400">{subLabel}</div>}
      </div>
      <div data-testid="row-cells" className="flex shrink-0 items-center gap-3">
        {ownerSlot && <span className="w-[92px] truncate text-right">{ownerSlot}</span>}
        {rateSlot && <span className="w-[64px] text-right">{rateSlot}</span>}
        {valueSlot ?? (
          <span className={`text-sm font-medium ${valueClassName ?? "text-gray-100"}`}>{value}</span>
        )}
        {editMode && deletable && onDelete ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-white hover:text-white"
            aria-label={`Delete ${label}`}
          >
            <TrashIcon />
          </button>
        ) : onEdit && !editMode ? (
          <button
            onClick={(e) => {
              // Both are required: stopPropagation blocks an ancestor's React
              // onClick, preventDefault cancels the browser default (anchor
              // navigation) when the row sits inside a link.
              e.preventDefault();
              e.stopPropagation();
              onEdit();
            }}
            className="text-gray-500 hover:text-accent"
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
          >
            <PencilIcon width={12} height={12} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default Row;
