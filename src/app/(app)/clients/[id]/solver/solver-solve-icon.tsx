// src/app/(app)/clients/[id]/solver/solver-solve-icon.tsx
"use client";

interface Props {
  label: string;
  /** "What does this solve for" copy revealed on hover / keyboard focus. */
  tooltip?: string;
  disabled?: boolean;
  onClick: () => void;
}

export function SolverSolveIcon({ label, tooltip, disabled, onClick }: Props) {
  const hint = disabled ? "Another solve is running" : tooltip;
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-hair-2 bg-card-2 px-2 text-[11px] font-medium text-ink-2 transition hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="5" />
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2" strokeLinecap="round" />
        </svg>
        <span>Solve</span>
      </button>
      {hint ? (
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 w-56 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-hair bg-card px-3 py-2 text-[11px] leading-snug text-ink-2 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {hint}
        </span>
      ) : null}
    </span>
  );
}
