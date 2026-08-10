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
  /** When set, opens the full editor — from a pencil button, and from a click
   *  on the row's name. */
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
  // The name takes the click as well as the pencil: it is text, not a control,
  // so a click landing there was never meant for anything else. Suppressed when
  // the whole row is already clickable — a nested button would fire `onEdit`
  // AND bubble into `onClick`.
  const nameOpensEditor = onEdit != null && !editMode && !rowClickable;
  return (
    <div
      onClick={hasInlineSlots ? undefined : onClick}
      data-row-clickable={rowClickable ? "true" : undefined}
      className={`flex items-center justify-between gap-2 px-4 py-2 ${
        rowClickable ? "cursor-pointer hover:bg-gray-800/60" : ""
      } ${outOfEstate ? "bg-amber-950/10" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* `title` so a name that still doesn't fit at the narrowest pane
              width is readable on hover rather than lost to the ellipsis. */}
          {nameOpensEditor ? (
            <button
              type="button"
              // Same pair as the pencil below: stopPropagation blocks an
              // ancestor's React onClick, preventDefault cancels the anchor
              // navigation when the row sits inside a link.
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit!();
              }}
              title={label}
              className="cursor-pointer truncate text-left text-sm font-medium text-gray-100 hover:text-accent"
            >
              {label}
            </button>
          ) : (
            <span title={label} className="truncate text-sm font-medium text-gray-100">
              {label}
            </span>
          )}
          {outOfEstate && (
            <span className="rounded-sm bg-amber-900/30 px-1.5 py-0.5 text-xs font-medium text-amber-300">
              OOE
            </span>
          )}
        </div>
        {metaLine && (
          <div title={metaLine} className="truncate text-xs text-gray-400">
            {metaLine}
          </div>
        )}
      </div>
      {/* gap-2, not gap-3: five cells' worth of gutters is 20px of a card that
          sits two-up on the details page, and the name column pays for all of
          it. */}
      <div data-testid="row-cells" className="flex items-center gap-2 flex-shrink-0">
        {startSlot ? (
          <span className="w-[52px] text-right">{startSlot}</span>
        ) : starts ? (
          <span className="min-w-[72px] text-right text-xs text-gray-400">{starts}</span>
        ) : null}
        {/* 52px holds a four-digit year plus the cell's hover padding, and
            matches the width `InlineYearCell` arms its custom-year input at — so
            committing a year doesn't shift the columns. It used to be 104px,
            sized for "Client Retirement (2035)", which that cell no longer
            renders; every pixel over the year's own width came out of the name. */}
        {endSlot && <span className="w-[52px] text-right">{endSlot}</span>}
        {rateSlot && <span className="w-[56px] text-right">{rateSlot}</span>}
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
