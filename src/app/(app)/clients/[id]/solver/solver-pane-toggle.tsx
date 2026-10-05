"use client";

type ButtonProps = {
  /** True when the inputs pane is hidden and the report pane runs full width. */
  collapsed: boolean;
  onToggle: () => void;
  /** id of the pane the button shows/hides, for aria-controls. */
  controls: string;
};

/** The one control that collapses or restores the inputs pane. Expanded, it
 *  rides at the end of the inputs pane's own tab bar; collapsed, it sits in
 *  {@link SolverCollapsedInputsRail}. Desktop only — below lg the panes stack
 *  and inputs are always shown, so callers hide it there. */
export function SolverPaneToggleButton({ collapsed, onToggle, controls }: ButtonProps) {
  const label = collapsed ? "Show inputs" : "Hide inputs";
  return (
    // btn-ghost's language (hairline → accent on hover), not the class
    // itself: its 0.75rem padding is unlayered CSS and would beat any
    // size utility set here.
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
  );
}

/** What's left of the inputs pane while it is collapsed: a slim rail with the
 *  boundary hairline, the restore control, and an "Inputs" label so the chevron
 *  isn't the sole clue about what comes back. Rendered only while collapsed —
 *  an always-on rail left an empty strip between the expanded pane's scrollbar
 *  and the divider. Desktop only. */
export function SolverCollapsedInputsRail({ onToggle, controls }: Omit<ButtonProps, "collapsed">) {
  return (
    <div className="hidden border-r-2 border-hair-3 lg:block">
      <div className="sticky top-0 flex flex-col items-center gap-3 pt-2">
        <SolverPaneToggleButton collapsed onToggle={onToggle} controls={controls} />
        <span
          aria-hidden="true"
          className="rotate-180 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3 [writing-mode:vertical-rl]"
        >
          Inputs
        </span>
      </div>
    </div>
  );
}
