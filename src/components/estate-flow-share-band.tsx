import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/icons";

/** "88%", or "<1%" for a sliver that would otherwise round to nothing. */
function percent(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}

/**
 * Header of an Estate Flow death-column box. A band behind it fills to the
 * box's share of the column in the box's hue, so the stacked boxes read as the
 * split of the estate; the line under the label states that share as a
 * percent. Clicking it opens the box.
 */
export function ShareBandButton({
  open,
  onToggle,
  share,
  hue,
  hatched = false,
  shareOf,
  label,
  figure,
  flag,
}: {
  open: boolean;
  onToggle: () => void;
  /** Fraction of the column, 0–1. Zero draws no band. */
  share: number;
  /** CSS colour of the band's edge, its wash and the percent. */
  hue: string;
  /** Stripes the band — for what passes by default order, with no plan. */
  hatched?: boolean;
  /** What the percent is a share of, e.g. "the total". */
  shareOf: string;
  label: string;
  figure: ReactNode;
  flag?: ReactNode;
}) {
  const wash = `color-mix(in srgb, ${hue} 16%, transparent)`;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="relative isolate grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-px bg-card-2 py-2 pl-2.5 pr-3 text-left hover:bg-card-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hair-2"
    >
      {share > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 -z-10 min-w-[3px] motion-safe:transition-[width] motion-safe:duration-500"
          style={{
            width: `${Math.min(share, 1) * 100}%`,
            background: hatched
              ? `repeating-linear-gradient(135deg, ${wash} 0 5px, transparent 5px 9px), ${wash}`
              : wash,
            boxShadow: `inset 0 -3px 0 ${hue}`,
          }}
        />
      )}
      <ChevronRightIcon
        width={12}
        height={12}
        strokeWidth={1.5}
        aria-hidden="true"
        className={`self-center text-ink-4 motion-safe:transition-transform ${open ? "rotate-90" : ""}`}
      />
      <span className="truncate text-[13px] font-semibold text-ink" title={label}>
        {label}
      </span>
      <span className="whitespace-nowrap text-[13.5px] font-semibold tabular-nums text-ink">
        {figure}
      </span>
      <span className="col-span-2 col-start-2 flex items-center gap-2 text-[11px] text-ink-3">
        <span>
          <span className="font-semibold tabular-nums" style={{ color: hue }}>
            {percent(share)}
          </span>{" "}
          of {shareOf}
        </span>
        {flag}
      </span>
    </button>
  );
}
