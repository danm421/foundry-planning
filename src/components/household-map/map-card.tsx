import type { ReactNode } from "react";
import type { MapItem } from "@/lib/household-map/types";

const CATEGORY_BORDER: Record<MapItem["category"], string> = {
  investments: "border-l-[color:var(--color-cat-income)]",
  property: "border-l-[color:var(--color-cat-portfolio)]",
  debt: "border-l-[color:var(--color-crit)]",
  insurance: "border-l-[color:var(--color-cat-insurance)]",
  entity: "border-l-[color:var(--color-cat-life)]",
};

interface MapCardProps {
  item: MapItem;
  /** Optional glyph rendered ahead of the name. */
  icon?: ReactNode;
  onClick?: () => void;
}

/**
 * One card on a Household Map board: a category-coloured left border, an icon
 * slot, the name, the value, and at most one chip. Ownership context wins over
 * the free-form note when both are present — an item sitting in the tray or on
 * an uneven split needs to say why before it says anything else.
 */
export default function MapCard({ item, icon, onClick }: MapCardProps) {
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
      <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-ink-2">
        {item.valueLabel}
      </span>
    </>
  );

  const className = `flex w-full items-center gap-2.5 rounded-lg border border-hair border-l-2 bg-card-2 px-3 py-2 text-left ${CATEGORY_BORDER[item.category]}`;

  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={`${className} hover:bg-card-hover`}>
      {body}
    </button>
  );
}
