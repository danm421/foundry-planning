"use client";

import type { ReactNode } from "react";
import { useState } from "react";

interface TaxDetailTooltipProps {
  text: string;
  /** Optional inline label rendered before the icon. Omit for an icon-only tooltip. */
  label?: ReactNode;
  /** Accessible label for the info icon button. */
  iconLabel?: string;
}

/**
 * Column-header tooltip: shows the header label followed by a small info icon
 * that reveals an explanation on hover or focus. Icon is keyboard-accessible
 * via tab + focus.
 */
export function TaxDetailTooltip({ text, label, iconLabel = "Show column explanation" }: TaxDetailTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex items-center gap-1">
      {label != null && <span>{label}</span>}
      <span
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label={iconLabel}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-card-2 text-xs text-ink-3 hover:bg-card-hover focus:bg-card-hover focus:outline-none"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          ⓘ
        </button>
        {open && (
          <span
            role="tooltip"
            className="absolute top-full left-1/2 z-50 mt-1 w-64 -translate-x-1/2 rounded-md border border-hair-2 bg-card px-3 py-2 text-xs font-normal text-ink shadow-lg"
          >
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
