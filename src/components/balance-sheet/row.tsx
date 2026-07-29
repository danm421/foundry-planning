"use client";

import type { ReactNode } from "react";
import { TrashIcon } from "./icons";

function Row({
  onClick,
  editMode,
  onDelete,
  deletable = true,
  label,
  labelBadge,
  subLabel,
  value,
  valueClassName,
}: {
  onClick?: () => void;
  editMode: boolean;
  onDelete?: () => void;
  deletable?: boolean;
  label: string;
  labelBadge?: ReactNode;
  subLabel?: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between px-4 py-2 ${onClick ? "cursor-pointer hover:bg-gray-800/60" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-100">
          <span className="truncate">{label}</span>
          {labelBadge}
        </div>
        {subLabel && <div className="truncate text-xs text-gray-400">{subLabel}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-sm font-medium ${valueClassName ?? "text-gray-100"}`}>{value}</span>
        {editMode && deletable && onDelete && (
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
        )}
      </div>
    </div>
  );
}

export default Row;
