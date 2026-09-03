"use client";

import {
  resolveObservationsPageOptions,
  type ObservationsPageOptions,
} from "@/lib/presentations/pages/observations-next-steps/options-schema";
import { OBSERVATION_TOPICS, TOPIC_LABELS } from "@/lib/schemas/observations";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

interface Props {
  value: ObservationsPageOptions;
  onChange: (next: ObservationsPageOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function ObservationsOptionsControl({ value, onChange }: Props) {
  /**
   * ⚠️⚠️ RESOLVED rather than read straight off `value`. The launcher hands
   * this control the deck's raw page options, unparsed — `selected-page-row.tsx`
   * passes `props.options as never`, and a deck saved before this task shipped
   * still carries the legacy `include` shape with neither boolean. Reading
   * `value.showObservations` directly would render an uncontrolled checkbox
   * (`checked={undefined}`). See `resolveObservationsPageOptions`'s doc comment
   * in options-schema.ts.
   *
   * Every `onChange` below writes from `resolved`, not `value` — once the
   * advisor touches any control here, the emitted object is the clean,
   * fully-booleaned shape, and a stray legacy `include` riding alongside is
   * dropped rather than carried forward.
   */
  const resolved = resolveObservationsPageOptions(value);

  function toggleTopic(topic: string, checked: boolean) {
    const topics = checked
      ? [...resolved.topics, topic]
      : resolved.topics.filter((t) => t !== topic);
    onChange({ ...resolved, topics });
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Sections">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={resolved.showObservations}
            onChange={(e) => onChange({ ...resolved, showObservations: e.target.checked })}
          />
          <span>Observations</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={resolved.showNextSteps}
            onChange={(e) => onChange({ ...resolved, showNextSteps: e.target.checked })}
          />
          <span>Next steps</span>
        </label>
        {!resolved.showObservations && !resolved.showNextSteps && (
          <span className="text-[11px] text-ink-3">Turn on at least one section — the page prints nothing otherwise.</span>
        )}
      </OptionsGroup>

      <OptionsGroup label="Content">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={resolved.includeCompleted}
            onChange={(e) => onChange({ ...resolved, includeCompleted: e.target.checked })}
          />
          <span>Include completed next steps</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={resolved.showOwnerAndDate}
            onChange={(e) => onChange({ ...resolved, showOwnerAndDate: e.target.checked })}
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
                checked={resolved.topics.includes(topic)}
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
          value={resolved.intro}
          onChange={(e) => onChange({ ...resolved, intro: e.target.value })}
        />
        <span className="text-[11px] text-ink-3">
          Supports merge tokens (e.g. {"{{client_first_name}}"}); include a Monte Carlo page for {"{{mc_success}}"}.
        </span>
      </OptionsGroup>
    </OptionsRow>
  );
}
