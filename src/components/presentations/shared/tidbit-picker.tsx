"use client";

import { OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TIDBITS, type TidbitTopic } from "@/lib/presentations/tidbits";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}

const TOPIC_LABELS: Record<TidbitTopic, string> = {
  compounding: "Compounding",
  taxes: "Taxes",
  debt: "Debt",
  behavior: "Behavior",
  accounts: "Accounts",
  risk: "Risk",
};

const TOPIC_ORDER: TidbitTopic[] = [
  "compounding",
  "taxes",
  "debt",
  "behavior",
  "accounts",
  "risk",
];

/**
 * Checkbox list of educational tidbits, grouped by topic. Caps the picker at
 * `max` selections (default 2, matching the sidebar's width): once the cap
 * is reached, unchecked boxes are disabled and a click on one does nothing —
 * the advisor's oldest pick is never silently evicted. Deselecting always
 * works, cap or no cap.
 */
export function TidbitPicker({ value, onChange, max = 2 }: Props) {
  const atCap = value.length >= max;

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    if (atCap) return;
    onChange([...value, id]);
  }

  return (
    <div className="flex flex-col gap-3">
      {TOPIC_ORDER.map((topic) => (
        <OptionsGroup key={topic} label={TOPIC_LABELS[topic]}>
          <div className="flex flex-col gap-1">
            {TIDBITS.filter((t) => t.topic === topic).map((t) => {
              const checked = value.includes(t.id);
              const disabled = !checked && atCap;
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "hover:text-ink"}`}
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(t.id)}
                  />
                  <span>{t.title}</span>
                </label>
              );
            })}
          </div>
        </OptionsGroup>
      ))}
      <span className="text-[11px] text-ink-3">
        Pick up to {max} — they render beside the chart on this page.
      </span>
    </div>
  );
}
