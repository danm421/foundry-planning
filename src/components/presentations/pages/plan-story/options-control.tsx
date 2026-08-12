// What prints, which plan it presents, and the panel where a human reads it
// first. One control, because the advisor's mental model is "this report, with
// options" — the review panel below the toggles is the same story the toggles
// describe, on the same scenario.
"use client";
import { useId } from "react";
import {
  applyPreset,
  type PlanStoryOptions,
  type PresetId,
} from "@/lib/presentations/pages/plan-story/options-schema";
import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { useClientId, useScenarioOptions } from "@/components/presentations/options-context";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { PlanStoryReviewPanel } from "./review-panel";

const PRESET_CHOICES: Array<{ id: PresetId; label: string }> = [
  { id: "full", label: "Full story" },
  { id: "brief", label: "Executive brief" },
];

const caption = "text-[11px] uppercase tracking-[0.1em] text-ink-3";

export function PlanStoryOptionsControl({
  value,
  onChange,
}: {
  value: PlanStoryOptions;
  onChange: (next: PlanStoryOptions) => void;
}) {
  const clientId = useClientId();
  const scenarios = useScenarioOptions();
  /** A real `<label for>` needs a real id, and this control can render twice on
   *  one page (two Plan Story entries in the same deck). */
  const scenarioFieldId = useId();

  // Live scenarios only — the same set `ScenarioPickerDropdown` calls live, and
  // load-bearing rather than tidy here. Everything this drops writes a
  // `scenarioId` that `planStoryProposedRef` reads as "there IS a proposed
  // plan" while the story has nothing to propose, so the report prints the
  // heading "What we're recommending, and why" over "We aren't suggesting
  // changes to the plan this time":
  //   · the base-case row — a plan compared against itself;
  //   · `writer-test-*` orphans left by integration tests that crashed;
  //   · a `snap:` ref — refused outright by generation (400) while GET answers
  //     200 with an all-never-generated list, so the panel would offer a
  //     Generate button that can only fail.
  const liveScenarios = scenarios.filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-") && !s.id.startsWith("snap:"),
  );

  return (
    <div className="space-y-4">
      <OptionsRow>
        <OptionsGroup label="Preset">
          {PRESET_CHOICES.map((p) => (
            <label key={p.id} className="flex items-center gap-2 hover:text-ink">
              <input
                type="radio"
                name="plan-story-preset"
                className="accent-accent"
                checked={value.preset === p.id}
                onChange={() => onChange(applyPreset(value, p.id))}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </OptionsGroup>

        <OptionsGroup label="Chapters">
          {CHAPTER_IDS.map((id) => (
            <label key={id} className="flex items-center gap-2 hover:text-ink">
              <input
                type="checkbox"
                className="accent-accent"
                checked={value.sections[id]}
                onChange={(e) =>
                  // Any manual toggle drops the report out of a named preset —
                  // otherwise the launcher row would keep claiming "Full story"
                  // for a deck that no longer is one.
                  onChange({
                    ...value,
                    preset: "custom",
                    sections: { ...value.sections, [id]: e.target.checked },
                  })
                }
              />
              <span>{CHAPTERS[id].title}</span>
            </label>
          ))}
        </OptionsGroup>

        <OptionsGroup>
          <div className={`flex items-center gap-1.5 ${caption}`}>
            {/* A real label rather than an `aria-label`: it names the control to
                a screen reader AND gives the caption a click target. */}
            <label htmlFor={scenarioFieldId}>Proposed plan</label>
            <FieldTooltip text="The scenario this report recommends. Leave it at no proposed plan for a base-only story — the report then skips 'What we're recommending, and why'. This is the story's subject, not the deck's scenario." />
          </div>
          <select
            id={scenarioFieldId}
            className="w-56 rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            value={value.scenarioId}
            onChange={(e) => onChange({ ...value, scenarioId: e.target.value })}
          >
            <option value="">— No proposed plan —</option>
            {liveScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </OptionsGroup>
      </OptionsRow>

      {/* `useClientId()` answers "" with no provider, and a component-library
          render of this control must not fire a GET at /api/clients//plan-story. */}
      {clientId !== "" && (
        <div className="space-y-2 border-t border-hair pt-4">
          <div className={caption}>Review</div>
          {/* `documentRole` travels with the scenario: the panel is the only
              caller of the generate route, so this is where the preset stops
              being a page-layout choice and becomes what the model is told. */}
          <PlanStoryReviewPanel
            clientId={clientId}
            scenarioId={value.scenarioId}
            documentRole={value.documentRole}
          />
        </div>
      )}
    </div>
  );
}
