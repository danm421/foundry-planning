"use client";

interface Props {
  name: string;
  summary: string;
  /** Technique participates in the projection. Default true. */
  enabled?: boolean;
  /** Flips the on/off (enabled) state. */
  onToggle?: () => void;
  /** When set, the row shows Edit / Remove controls (working column). */
  onEdit?: () => void;
  onRemove?: () => void;
  /** Origin/diff badge. */
  badge?: "Added" | "Edited" | "Removed" | "Base plan";
  /** Extra control rendered before Edit (e.g. a Solve button). */
  extraAction?: React.ReactNode;
}

export function SolverTechniqueRow({
  name,
  summary,
  enabled = true,
  onToggle,
  onEdit,
  onRemove,
  badge,
  extraAction,
}: Props) {
  const isBase = badge === "Base plan";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-hair-2 bg-card-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {onToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`Include ${name} in projection`}
            onClick={onToggle}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              enabled ? "bg-accent" : "bg-hair-2"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : null}
        <div className={`min-w-0 ${enabled ? "" : "opacity-50"}`}>
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{name}</span>
            {badge ? (
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  isBase
                    ? "bg-card text-ink-3 border border-hair-2"
                    : "bg-accent/15 text-accent"
                }`}
              >
                {badge}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[12px] text-ink-3">{summary}</div>
        </div>
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
