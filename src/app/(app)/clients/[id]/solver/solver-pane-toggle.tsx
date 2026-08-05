"use client";

type Props = {
  /** True when the inputs pane is hidden and the report pane runs full width. */
  collapsed: boolean;
  onToggle: () => void;
  /** id of the pane the button shows/hides, for aria-controls. */
  controls: string;
};

/** Slim rail between the inputs and report panes. It carries the boundary
 *  hairline and the one control that collapses the inputs pane, so the rail
 *  (and the button) stay put whichever state the workspace is in. Desktop
 *  only — below lg the panes stack and inputs are always shown. */
export function SolverPaneToggle({ collapsed, onToggle, controls }: Props) {
  const label = collapsed ? "Show inputs" : "Hide inputs";
  return (
    <div className="group hidden border-r border-hair transition-colors hover:border-hair-2 lg:block">
      <div className="sticky top-0 flex flex-col items-center gap-3 pt-2">
        {/* btn-ghost's language (hairline → accent on hover), not the class
            itself: its 0.75rem padding is unlayered CSS and would beat any
            size utility set here. */}
        <button
          type="button"
          onClick={onToggle}
          aria-controls={controls}
          aria-expanded={!collapsed}
          title={label}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-hair-2 bg-card text-ink transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path
              d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">{label}</span>
        </button>

        {/* Collapsed, the rail is the only trace of the inputs pane — name it
            so the chevron isn't the sole clue about what comes back. */}
        {collapsed ? (
          <span
            aria-hidden="true"
            className="rotate-180 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3 [writing-mode:vertical-rl]"
          >
            Inputs
          </span>
        ) : null}
      </div>
    </div>
  );
}
