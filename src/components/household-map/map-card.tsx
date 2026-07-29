import type { ReactNode } from "react";
import type { MapItem } from "@/lib/household-map/types";

const CATEGORY_BORDER: Record<MapItem["category"], string> = {
  investments: "border-l-[color:var(--color-cat-income)]",
  property: "border-l-[color:var(--color-cat-portfolio)]",
  // Reserved for actual debt (liabilities). `--color-crit` is the app's ERROR
  // red, so an ordinary grocery card wearing it reads as an alert — everyday
  // outflows use `household` below.
  debt: "border-l-[color:var(--color-crit)]",
  household: "border-l-[color:var(--color-cat-transactions)]",
  insurance: "border-l-[color:var(--color-cat-insurance)]",
};

interface MapCardProps {
  item: MapItem;
  /** Optional glyph rendered ahead of the name. */
  icon?: ReactNode;
  /** Leading cell of the trailing group, ahead of `rateSlot`. The Cash Flow
   *  board's start/end year range. */
  metaSlot?: ReactNode;
  /** Growth rate, rendered between the name and the value. Net Worth board only. */
  rateSlot?: ReactNode;
  /** Trailing affordance (the edit pencil). */
  actionSlot?: ReactNode;
  /** Replaces the formatted value. Used for the inline editor. */
  valueSlot?: ReactNode;
}

/**
 * One card on a Household Map board: a category-coloured left border, an icon
 * slot, the name, the value, and at most one chip. Ownership context wins over
 * the free-form note when both are present — an item sitting in the tray or on
 * an uneven split needs to say why before it says anything else.
 *
 * The card itself is never interactive. Both boards now edit in place — an
 * inline value editor plus a pencil for the full dialog — and those are
 * `<button>`s, which cannot legally nest inside a card-level `<button>`. Callers
 * that still want the whole card to go somewhere wrap it in a `<Link>` (see
 * `NetWorthBoard.renderCard`, which does exactly that for the liability and
 * policy rows it cannot edit in place).
 */
export default function MapCard({
  item,
  icon,
  metaSlot,
  rateSlot,
  actionSlot,
  valueSlot,
}: MapCardProps) {
  const chip = item.trayOwnerLabel ?? item.splitChip ?? item.noteChip;
  const body = (
    <>
      {icon ? <span className="shrink-0 text-ink-3">{icon}</span> : null}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-ink">{item.name}</span>
        {chip ? (
          <span className="truncate rounded bg-card px-1.5 py-px text-[10px] text-ink-3">
            {chip}
          </span>
        ) : null}
      </span>
      {/* `tabular` (the design system's mono-numeral class) replaces the raw
          `tabular-nums` utility so the rate and the value align on the same
          numeral width once both slots are filled. */}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {metaSlot}
        {rateSlot}
        {valueSlot ?? (
          <span className="text-xs font-semibold tabular text-ink-2">{item.valueLabel}</span>
        )}
        {actionSlot}
      </span>
    </>
  );

  // `group-hover:` is inert unless an ancestor carries `group` — it exists so a
  // card wrapped in a <Link> (Net Worth board) gets a hover affordance that says
  // it navigates. A card that edits in place instead has no `group` ancestor and
  // stays flat, which is correct: the affordances are the inline value and the
  // pencil, not the card.
  const className = `flex w-full items-center gap-2.5 rounded-lg border border-hair border-l-2 bg-card-2 px-3 py-2 text-left group-hover:bg-card-hover ${CATEGORY_BORDER[item.category]}`;

  return <div className={className}>{body}</div>;
}
