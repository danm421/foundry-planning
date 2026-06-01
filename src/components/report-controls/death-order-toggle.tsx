"use client";

export interface DeathOrderToggleProps {
  value: "primaryFirst" | "spouseFirst";
  onChange: (next: "primaryFirst" | "spouseFirst") => void;
  ownerNames: { clientName: string; spouseName: string | null };
}

export function DeathOrderToggle({ value, onChange, ownerNames }: DeathOrderToggleProps) {
  const primaryLabel = ownerNames.clientName;
  const spouseLabel = ownerNames.spouseName ?? "Spouse";

  return (
    <div
      role="group"
      aria-label="Death order"
      className="flex items-center gap-1 rounded border border-hair p-0.5"
    >
      <button
        type="button"
        aria-pressed={value === "primaryFirst"}
        onClick={() => onChange("primaryFirst")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "primaryFirst"
            ? "bg-accent text-[var(--color-accent-on)]"
            : "text-ink-4 hover:text-ink-2"
        }`}
      >
        {primaryLabel} dies first
      </button>
      <button
        type="button"
        aria-pressed={value === "spouseFirst"}
        onClick={() => onChange("spouseFirst")}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "spouseFirst"
            ? "bg-accent text-[var(--color-accent-on)]"
            : "text-ink-4 hover:text-ink-2"
        }`}
      >
        {spouseLabel} dies first
      </button>
    </div>
  );
}
