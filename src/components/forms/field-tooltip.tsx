"use client";

/**
 * Inline `?` badge that reveals an explanatory tooltip on hover or keyboard
 * focus. Use next to a form label when the longer "what does this do" copy
 * would clutter the row.
 *
 * The tooltip floats *above* the badge (centered horizontally) so it extends
 * vertically rather than horizontally — sideways positioning would push the
 * tooltip past the dialog edge in narrow modals and force a horizontal scroll.
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
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 w-56 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-hair bg-card px-3 py-2 text-xs leading-snug text-ink-2 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
