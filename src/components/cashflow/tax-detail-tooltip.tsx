"use client";

import type { ReactNode } from "react";
import { useState } from "react";

interface TaxDetailTooltipProps {
  text: string;
  label: ReactNode;
}

/**
 * Column-header tooltip: shows the header label followed by a small info icon
 * that reveals an explanation on hover or focus. Icon is keyboard-accessible
 * via tab + focus.
 */
export function TaxDetailTooltip({ text, label }: TaxDetailTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label="Show column explanation"
          className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 focus:bg-gray-600 focus:outline-none"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          ⓘ
        </button>
        {open && (
          <span
            role="tooltip"
            className="absolute top-full left-1/2 z-50 mt-1 w-64 -translate-x-1/2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-normal text-gray-200 shadow-lg"
          >
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
