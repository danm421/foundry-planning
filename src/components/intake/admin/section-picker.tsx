"use client";

import {
  INTAKE_SECTIONS,
  INTAKE_SECTION_LABELS,
  INTAKE_SECTION_PRESETS,
  matchPreset,
  normalizeSections,
  type IntakeSectionKey,
} from "@/lib/intake/sections";
import { FieldTooltip } from "@/components/forms/field-tooltip";

export interface SectionPickerProps {
  value: readonly IntakeSectionKey[];
  onChange: (next: IntakeSectionKey[]) => void;
  /** A prospect send has no client row to borrow a date of birth from, so
   *  Family cannot be dropped. Disabled + explained rather than hidden: the
   *  advisor should see that the step is there and why. */
  familyLocked?: boolean;
}

// Same chip shape as the Recipient toggle on the send card — one segmented
// control idiom on this page, not two.
const chipCls = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active ? "bg-accent-wash font-medium text-accent" : "text-ink-3 hover:text-ink"
  }`;

/**
 * Preset chips over a checkbox list.
 *
 * There is deliberately no "My default" chip. The caller seeds `value` from the
 * saved default; if that set matches a named preset, that chip lights up, and
 * otherwise Custom does. One less concept, and a chip claiming to be "my
 * default" can never drift out of sync with what the default actually is.
 */
export function SectionPicker({ value, onChange, familyLocked }: SectionPickerProps) {
  const active = matchPreset(value) ?? "custom";

  function toggle(key: IntakeSectionKey) {
    if (familyLocked && key === "family") return;
    const next = value.includes(key)
      ? value.filter((k) => k !== key)
      : [...value, key];
    // A form that collects nothing is a bug, not a preference — and the create
    // route would 400 it anyway. Refuse the interaction instead of emitting a
    // set the caller cannot send.
    if (next.length === 0) return;
    // Ordered exactly once, on the way out — so a caller that hands us a
    // non-canonical `value` still gets a canonical set back.
    onChange(normalizeSections(next));
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-full border border-hair bg-card-2 p-0.5"
        role="group"
        aria-label="Form steps"
      >
        {INTAKE_SECTION_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={active === p.key}
            onClick={() => onChange(normalizeSections([...p.sections]))}
            className={chipCls(active === p.key)}
          >
            {p.label}
          </button>
        ))}
        {/* Not a control: "Custom" is what you GET by editing the checkboxes,
            never something you pick. It carries the group's role so the
            segmented control reads as one set, and aria-disabled so a screen
            reader doesn't offer it as an action. */}
        <span
          role="button"
          aria-pressed={active === "custom"}
          aria-disabled="true"
          className={chipCls(active === "custom")}
        >
          Custom
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {INTAKE_SECTIONS.map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={value.includes(key)}
                disabled={familyLocked && key === "family"}
                onChange={() => toggle(key)}
                className="accent-[var(--color-accent)] disabled:opacity-50"
              />
              {INTAKE_SECTION_LABELS[key]}
            </label>
            {/* Outside the <label> on purpose: a button nested in a label
                forwards its click to the checkbox. */}
            {familyLocked && key === "family" && (
              <FieldTooltip text="A form for a new prospect always collects Family — it's the only place we learn their date of birth, and a plan can't be projected without it." />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
