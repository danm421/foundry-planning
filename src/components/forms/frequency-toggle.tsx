"use client";

export const SHORT = { monthly: "/mo", annual: "/yr" } as const;

export function FrequencyToggle({
  value,
  onChange,
  label,
}: {
  value: "monthly" | "annual";
  onChange: (next: "monthly" | "annual") => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={`How often for ${label}`} className="inline-flex shrink-0 gap-0.5 rounded-md border border-hair p-0.5 text-xs">
      {(["monthly", "annual"] as const).map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={value === f}
          onClick={() => {
            if (value !== f) onChange(f);
          }}
          className={`rounded border px-1.5 ${
            value === f ? "border-accent bg-accent/15 text-accent" : "border-transparent text-ink-3 hover:text-ink-2"
          }`}
        >
          {SHORT[f]}
        </button>
      ))}
    </div>
  );
}
