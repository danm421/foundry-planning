"use client";

import { useScenarioOptions } from "@/components/presentations/options-context";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import type { ScenarioComparisonOptions } from "@/lib/presentations/pages/scenario-comparison/types";

interface Props {
  value: ScenarioComparisonOptions;
  onChange: (next: ScenarioComparisonOptions) => void;
}

const TONES = ["concise", "detailed", "plain"] as const;
const CONFIDENCE_TARGETS = ["0.75", "0.8", "0.85", "0.9"] as const;
const MAX_SCENARIOS = 3;

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function ScenarioComparisonOptionsControl({ value, onChange }: Props) {
  // Unconditional — no early return sits above this, so a later hook added to
  // this component can never land after a conditional branch (rules-of-hooks).
  const scenarios = useScenarioOptions();

  // Base Case never appears in the picker (it's the fixed column 1, not a
  // choice), and neither does a snapshot: `useScenarioOptions()` is typed
  // `ScenarioOption[]` with no snapshot field, so this list is structurally
  // scenario-only — the `snap:` guard is a defensive second line in case a
  // future context change ever starts prefixing ids that way, the convention
  // `ScenarioPickerDropdown` uses to disambiguate its own snapshot options.
  const liveScenarios = scenarios.filter((s) => !s.isBaseCase && !s.id.startsWith("snap:"));

  function setScenarioAt(index: number, id: string) {
    const next = [...value.scenarioIds];
    next[index] = id;
    onChange({ ...value, scenarioIds: next });
  }

  function removeScenarioAt(index: number) {
    onChange({ ...value, scenarioIds: value.scenarioIds.filter((_, i) => i !== index) });
  }

  function addScenario() {
    if (value.scenarioIds.length >= MAX_SCENARIOS) return;
    onChange({ ...value, scenarioIds: [...value.scenarioIds, ""] });
  }

  // Options for one row: every live scenario minus whatever the OTHER rows
  // already hold, so a scenario can't be picked into two columns at once. The
  // row's own current id stays in its own list even though it's "chosen" —
  // otherwise picking a scenario would immediately remove it from view.
  function optionsForRow(index: number) {
    const chosenElsewhere = new Set(
      value.scenarioIds.filter((_, i) => i !== index && Boolean(value.scenarioIds[i])),
    );
    return liveScenarios.filter((s) => !chosenElsewhere.has(s.id));
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Scenarios">
        <div className="flex items-center justify-between gap-2 rounded border border-hair bg-card-2 px-2 py-1 text-ink-3">
          <span>Base Case</span>
          <span className="text-[10px] uppercase tracking-[0.1em]">Column 1</span>
        </div>
        {value.scenarioIds.map((id, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              aria-label={`Scenario ${i + 1}`}
              className={`w-full ${field}`}
              value={id}
              onChange={(e) => setScenarioAt(i, e.target.value)}
            >
              <option value="">— Select a scenario —</option>
              {optionsForRow(i).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove scenario ${i + 1}`}
              className="shrink-0 rounded px-2 py-1 text-[11px] text-ink-3 hover:text-crit"
              onClick={() => removeScenarioAt(i)}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={value.scenarioIds.length >= MAX_SCENARIOS}
          className="rounded border border-hair px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          onClick={addScenario}
        >
          Add scenario
        </button>
      </OptionsGroup>

      <OptionsGroup label="Maximum spending">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.maxSpend.show}
            onChange={(e) => onChange({ ...value, maxSpend: { ...value.maxSpend, show: e.target.checked } })}
          />
          <span>Solves each column&apos;s sustainable spending. Adds time to the first export.</span>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Confidence target</span>
          <select
            aria-label="Max-spending confidence target"
            className={field}
            value={String(value.maxSpend.targetConfidence)}
            onChange={(e) =>
              onChange({ ...value, maxSpend: { ...value.maxSpend, targetConfidence: Number(e.target.value) } })
            }
          >
            {CONFIDENCE_TARGETS.map((v) => (
              <option key={v} value={v}>{`${Math.round(Number(v) * 100)}%`}</option>
            ))}
          </select>
        </label>
      </OptionsGroup>

      <OptionsGroup label="Display">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showChart}
            onChange={(e) => onChange({ ...value, showChart: e.target.checked })}
          />
          <span>Show chart</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showTradeoffBands}
            onChange={(e) => onChange({ ...value, showTradeoffBands: e.target.checked })}
          />
          <span>Show tradeoff bands</span>
        </label>
      </OptionsGroup>

      <OptionsGroup label="AI commentary">
        <label className="flex items-center justify-between gap-2">
          <span>Tone</span>
          <select
            aria-label="AI tone"
            className={field}
            value={value.ai.tone}
            onChange={(e) =>
              onChange({ ...value, ai: { ...value.ai, tone: e.target.value as ScenarioComparisonOptions["ai"]["tone"] } })
            }
          >
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Custom instructions</span>
          <textarea
            aria-label="AI custom instructions"
            className={`w-full ${field}`}
            rows={2}
            maxLength={2000}
            value={value.ai.customInstructions}
            onChange={(e) => onChange({ ...value, ai: { ...value.ai, customInstructions: e.target.value } })}
          />
        </label>
        <span className="text-[11px] text-ink-3">
          Length is set by the number of scenarios so the report always fits two pages.
        </span>
      </OptionsGroup>
    </OptionsRow>
  );
}
