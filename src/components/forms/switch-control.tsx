"use client";

/**
 * The house on/off switch: a hidden checkbox driving a styled pill track,
 * with an optional short state label to its left (e.g. "Allowed" / "Off").
 * Pulled out of `advisor-grant-list.tsx` and `book-silo-toggle.tsx`, which
 * both need it — the caller owns the optimistic-flip/revert logic (it
 * differs: one PATCHes a REST route per row, the other calls a server
 * action), this component owns only the markup and the on/off state.
 */
export function SwitchControl({
  checked,
  onChange,
  disabled,
  ariaLabel,
  stateLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Short label rendered left of the switch, e.g. "Allowed" / "Off". */
  stateLabel?: string;
}) {
  return (
    <label
      className={`inline-flex shrink-0 items-center gap-2.5 ${disabled ? "" : "cursor-pointer"}`}
    >
      {stateLabel !== undefined ? (
        <span className="text-xs text-ink-3">{stateLabel}</span>
      ) : null}
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-5 w-9 rounded-full bg-hair-2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
    </label>
  );
}
