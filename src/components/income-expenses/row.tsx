"use client";

import { InlineAmount } from "@/components/forms/inline-amount";
import { TrashIcon, PencilIcon } from "./icons";

function Row({
  onClick,
  editMode,
  onDelete,
  onEdit,
  label,
  meta,
  starts,
  value,
  amount,
  onSaveAmount,
  outOfEstate,
}: {
  onClick?: () => void;
  editMode: boolean;
  onDelete?: () => void;
  /** When set, renders a pencil button that opens the full editor. */
  onEdit?: () => void;
  label: string;
  meta?: (string | null | undefined)[];
  starts?: string;
  value: string;
  /** Raw numeric amount — required alongside `onSaveAmount` for inline editing. */
  amount?: number;
  /** When set (with `amount`), the value becomes an inline-editable field. */
  onSaveAmount?: (next: number) => Promise<boolean>;
  outOfEstate?: boolean;
}) {
  const metaLine = (meta ?? []).filter(Boolean).join(" · ");
  const interactive = Boolean(onClick);
  const inlineEditable = onSaveAmount != null && amount != null;
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-3 px-4 py-2 ${
        interactive ? "cursor-pointer hover:bg-gray-800/60" : ""
      } ${outOfEstate ? "bg-amber-950/10" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-100">{label}</span>
          {outOfEstate && (
            <span className="rounded-sm bg-amber-900/30 px-1.5 py-0.5 text-xs font-medium text-amber-300">
              OOE
            </span>
          )}
        </div>
        {metaLine && <div className="truncate text-xs text-gray-400">{metaLine}</div>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {starts && (
          <span className="min-w-[72px] text-right text-xs text-gray-400">{starts}</span>
        )}
        {inlineEditable ? (
          <InlineAmount amount={amount} onSave={onSaveAmount} label={label} />
        ) : (
          <span className="min-w-[88px] text-right text-sm font-medium text-gray-100">{value}</span>
        )}
        {editMode && onDelete ? (
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
              e.stopPropagation();
              onEdit();
            }}
            className="text-gray-500 hover:text-accent"
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default Row;
