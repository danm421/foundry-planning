"use client";

interface Props {
  name: string;
  summary: string;
  /** When set, the row shows Edit / Remove controls (working column). */
  onEdit?: () => void;
  onRemove?: () => void;
  /** Diff badge vs base: "Added" | "Edited" | "Removed". Optional. */
  badge?: "Added" | "Edited" | "Removed";
  /** Extra control rendered before Edit (e.g. a Solve button). */
  extraAction?: React.ReactNode;
}

export function SolverTechniqueRow({ name, summary, onEdit, onRemove, badge, extraAction }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-hair-2 bg-card-2 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{name}</span>
          {badge ? (
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[12px] text-ink-3">{summary}</div>
      </div>
      {onEdit || onRemove || extraAction ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {extraAction}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-hair-2 px-2 py-1 text-[12px] text-ink-2 hover:border-accent/60 hover:text-ink"
            >
              Edit
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove technique"
              className="rounded-md border border-hair-2 px-2 py-1 text-[12px] text-ink-2 hover:border-crit/60 hover:text-crit"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
