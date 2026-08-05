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
    <div className="hidden border-r border-hair lg:block">
      <button
        type="button"
        onClick={onToggle}
        aria-controls={controls}
        aria-expanded={!collapsed}
        title={label}
        className="flex h-11 w-full items-center justify-center text-ink-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}
