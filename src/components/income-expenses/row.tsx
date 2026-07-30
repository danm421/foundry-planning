"use client";

import type { ReactNode } from "react";
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
  startSlot,
  endSlot,
  rateSlot,
  outOfEstate,
}: {
  onClick?: () => void;
  editMode: boolean;
  onDelete?: () => void;
  /** When set, renders a pencil button that opens the full editor. */
  onEdit?: () => void;
  label: string;
  meta?: (string | null | undefined)[];
  /** Legacy combined "2026–2035" descriptor. Superseded by `startSlot`/`endSlot`. */
  starts?: string;
  value: string;
  /** Raw numeric amount — required alongside `onSaveAmount` for inline editing. */
  amount?: number;
  /** When set (with `amount`), the value becomes an inline-editable field. */
  onSaveAmount?: (next: number) => Promise<boolean>;
  /** Inline start-year cell. Takes precedence over `starts`. */
  startSlot?: ReactNode;
  /** Inline end-year cell. */
  endSlot?: ReactNode;
  /** Inline growth-rate cell. */
  rateSlot?: ReactNode;
  outOfEstate?: boolean;
}) {
  const metaLine = (meta ?? []).filter(Boolean).join(" · ");
  const inlineEditable = onSaveAmount != null && amount != null;
  // A row-level handler swallows clicks meant for the controls inside it, so a
  // row that has any inline cell gives up its own click entirely and routes to
  // the full editor through the pencil (`onEdit`) instead.
  const hasInlineSlots = Boolean(startSlot || endSlot || rateSlot);
  const rowClickable = !hasInlineSlots && onClick;
  return (
    <div
      onClick={hasInlineSlots ? undefined : onClick}
      data-row-clickable={rowClickable ? "true" : undefined}
      className={`flex items-center justify-between gap-3 px-4 py-2 ${
        rowClickable ? "cursor-pointer hover:bg-gray-800/60" : ""
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
      <div data-testid="row-cells" className="flex items-center gap-3 flex-shrink-0">
        {startSlot ? (
          <span className="w-[104px] text-right">{startSlot}</span>
        ) : starts ? (
          <span className="min-w-[72px] text-right text-xs text-gray-400">{starts}</span>
        ) : null}
        {endSlot && <span className="w-[104px] text-right">{endSlot}</span>}
        {rateSlot && <span className="w-[64px] text-right">{rateSlot}</span>}
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
            <PencilIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default Row;
