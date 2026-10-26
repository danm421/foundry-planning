"use client";

/**
 * One option in a row of single-choice chips — the account form's Details-tab
 * picker for a short, fixed set of choices (owner presets, a 529's grantor and
 * beneficiary), so every "pick one of these" there reads the same way.
 *
 * `radio` gives the chip radio semantics; leave it off for a toggle-style
 * preset button (`aria-pressed`).
 */
export function ChoiceChip({
  label,
  active,
  onClick,
  radio = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  radio?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(radio ? { role: "radio", "aria-checked": active } : { "aria-pressed": active })}
      className={
        "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors " +
        (active
          ? "border-accent bg-accent text-accent-on"
          : "border-hair bg-card-2 text-ink-3 hover:border-hair-2 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}
