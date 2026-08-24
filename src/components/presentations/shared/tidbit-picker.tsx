"use client";

import { OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TIDBITS, type TidbitTopic } from "@/lib/presentations/tidbits";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  /** Where the picks land, as a sentence tail. The picker composes
   *  "Pick up to {max} — {hint}" so the CAP is never re-typed by a caller and
   *  cannot drift from the one actually enforced; the default names the sidebar,
   *  and a page where the tidbits ARE the page passes its own tail. */
  hint?: string;
  /** The page's own default picks. Given, the picker offers "Reset to default";
   *  omitted, it offers nothing — a reset button with nothing behind it would
   *  silently clear the selection. */
  defaults?: string[];
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
export function TidbitPicker({
  value,
  onChange,
  max = 2,
  hint = "they render beside the chart on this page.",
  defaults,
}: Props) {
  const atCap = value.length >= max;
  // Order counts: the sidebar prints the picks top to bottom in the order they
  // are stored, so a re-picked pair in the other order is NOT the default.
  const isDefault =
    defaults != null &&
    value.length === defaults.length &&
    value.every((id, i) => id === defaults[i]);

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
      <div className="flex items-center gap-4">
        <span className="text-[11px] text-ink-3">{`Pick up to ${max} — ${hint}`}</span>
        {defaults != null && (
          <button
            type="button"
            disabled={isDefault}
            className={`ml-auto text-[11px] underline ${
              isDefault
                ? "cursor-default text-ink-4 no-underline"
                : "text-ink-3 hover:text-ink"
            }`}
            onClick={() => onChange([...defaults])}
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}
