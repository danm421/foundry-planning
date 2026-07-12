"use client";

import type { ObservationsPageOptions } from "@/lib/presentations/pages/observations-next-steps/options-schema";
import { OBSERVATION_TOPICS, TOPIC_LABELS } from "@/lib/schemas/observations";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

interface Props {
  value: ObservationsPageOptions;
  onChange: (next: ObservationsPageOptions) => void;
}

const INCLUDE_OPTIONS: { key: ObservationsPageOptions["include"]; label: string }[] = [
  { key: "both", label: "Both sections" },
  { key: "observations", label: "Observations only" },
  { key: "nextSteps", label: "Next Steps only" },
];

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function ObservationsOptionsControl({ value, onChange }: Props) {
  function toggleTopic(topic: string, checked: boolean) {
    const topics = checked
      ? [...value.topics, topic]
      : value.topics.filter((t) => t !== topic);
    onChange({ ...value, topics });
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Content">
        <label className="flex flex-col gap-1">
          <span>Sections</span>
          <select
            aria-label="Sections to include"
            className={field}
            value={value.include}
            onChange={(e) =>
              onChange({ ...value, include: e.target.value as ObservationsPageOptions["include"] })
            }
          >
            {INCLUDE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.includeCompleted}
            onChange={(e) => onChange({ ...value, includeCompleted: e.target.checked })}
          />
          <span>Include completed next steps</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showOwnerAndDate}
            onChange={(e) => onChange({ ...value, showOwnerAndDate: e.target.checked })}
          />
          <span>Show owner &amp; target date</span>
        </label>
      </OptionsGroup>

      <OptionsGroup label="Topics">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {OBSERVATION_TOPICS.map((topic) => (
            <label key={topic} className="flex items-center gap-2 hover:text-ink">
              <input
                type="checkbox"
                className="accent-accent"
                checked={value.topics.includes(topic)}
                onChange={(e) => toggleTopic(topic, e.target.checked)}
              />
              <span>{TOPIC_LABELS[topic]}</span>
            </label>
          ))}
        </div>
        <span className="text-[11px] text-ink-3">No topics checked = all topics shown</span>
      </OptionsGroup>

      <OptionsGroup label="Intro">
        <textarea
          aria-label="Intro markdown"
          className={`w-full resize-y ${field}`}
          rows={4}
          placeholder="Optional intro text above the observations…"
          value={value.intro}
          onChange={(e) => onChange({ ...value, intro: e.target.value })}
        />
        <span className="text-[11px] text-ink-3">
          Supports merge tokens (e.g. {"{{client_first_name}}"}); include a Monte Carlo page for {"{{mc_success}}"}.
        </span>
      </OptionsGroup>
    </OptionsRow>
  );
}
