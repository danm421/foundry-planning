// src/app/(app)/clients/[id]/solver/solver-solve-icon.tsx
"use client";

interface Props {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

export function SolverSolveIcon({ label, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={disabled ? "Another solve is running" : label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-hair-2 bg-card-2 text-ink-3 transition hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="5" />
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
