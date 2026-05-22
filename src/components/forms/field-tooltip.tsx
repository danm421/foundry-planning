"use client";

/**
 * Inline `?` badge that reveals an explanatory tooltip on hover or keyboard
 * focus. Use next to a form label when the longer "what does this do" copy
 * would clutter the row.
 *
 * Positioned absolutely with `z-50` — make sure the nearest scrolling
 * ancestor doesn't have `overflow-hidden` or the tooltip will clip.
 */
export function FieldTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label="Show help"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-ink-3 text-[10px] font-semibold leading-none text-ink-2 hover:border-ink-1 hover:text-ink-1 focus:border-ink-1 focus:text-ink-1 focus:outline-none"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 w-64 -translate-y-1/2 rounded-md border border-hair bg-card px-3 py-2 text-xs leading-snug text-ink-2 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
