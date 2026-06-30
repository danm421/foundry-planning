"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { ScenarioPickerDropdown } from "@/components/scenario/scenario-picker-dropdown";

// Sentinel for the inline picker's leading "Default (…)" option, which maps
// back to a `scenarioOverride` of `undefined` (inherit the deck's scenario).
const DEFAULT_OVERRIDE = "__default__";

interface Props {
  index: number;
  pageId: PresentationPageId;
  options: unknown;
  scenarioOverride: string | null | undefined;
  /** Resolved name of the deck's top-level scenario, shown as "Default (…)". */
  deckScenarioLabel: string;
  onOptionsChange: (next: unknown) => void;
  onScenarioOverrideChange: (next: string | null | undefined) => void;
  onRemove: () => void;
  onPreview: () => void;
  /** Omitted for view-only access — hides the Download button entirely. */
  onDownload?: () => void;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function SelectedPageRow(props: Props) {
  const page = PRESENTATION_PAGES[props.pageId];
  const [showOptions, setShowOptions] = useState(false);
  const summary = page.summarizeOptions(props.options as never);
  const Options = page.OptionsControl;

  const hasOverride = props.scenarioOverride !== undefined;

  // The inline picker's leading sentinel means "Default" (inherit the deck).
  // `null` and the string "base" both surface as the explicit "Base case".
  const scenarioSelectValue =
    props.scenarioOverride === undefined
      ? DEFAULT_OVERRIDE
      : (props.scenarioOverride ?? "base");

  // Pages like Retirement Comparison store the "compare to" scenario *inside*
  // their options (the baseline is always Base Case). Surface it as an inline
  // picker in place of the static "Base plan" chip so it can be set without
  // opening Options. Live scenarios only — mirrors the Options-dialog list.
  const inlineScenario = page.inlineScenarioOption;
  const inlineScenarioValue = inlineScenario
    ? inlineScenario.get(props.options as never)
    : "";
  const comparisonScenarios = props.scenarios.filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-"),
  );

  return (
    <div className="rounded border border-hair bg-card-2 p-3 space-y-2 transition-colors hover:border-hair-2">
      <div className="flex items-center gap-3">
        <span
          className="cursor-grab text-ink-4 select-none hover:text-ink-3"
          aria-hidden
        >
          ⠿
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium text-ink">{page.title}</div>
          <div className="text-xs text-ink-2">{summary}</div>
        </div>
        <button
          type="button"
          aria-label={`Preview ${page.title}`}
          className="rounded px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-card-hover hover:text-ink"
          onClick={props.onPreview}
        >
          Preview
        </button>
        {props.onDownload && (
          <button
            type="button"
            aria-label={`Download ${page.title}`}
            className="rounded px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-card-hover hover:text-ink"
            onClick={props.onDownload}
          >
            Download
          </button>
        )}
        <button
          type="button"
          disabled={!Options}
          aria-label={`Options for ${page.title}`}
          title={Options ? undefined : "This page has no options"}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            !Options
              ? "cursor-not-allowed text-ink-4"
              : showOptions
                ? "bg-card-hover text-ink"
                : "text-ink-3 hover:bg-card-hover hover:text-ink"
          }`}
          onClick={() => setShowOptions((v) => !v)}
        >
          Options
        </button>
        {page.supportsScenarioOverride ? (
          <ScenarioPickerDropdown
            value={scenarioSelectValue}
            onChange={(v) =>
              props.onScenarioOverrideChange(
                v === DEFAULT_OVERRIDE ? undefined : v,
              )
            }
            scenarios={props.scenarios}
            snapshots={props.snapshots}
            ariaLabel={`Scenario for ${page.title}`}
            leadingOption={{
              value: DEFAULT_OVERRIDE,
              label: `Default (${props.deckScenarioLabel})`,
            }}
            className={`w-[13rem] rounded border bg-paper px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              hasOverride
                ? "border-accent text-accent"
                : "border-hair text-ink-3 hover:border-hair-2 hover:text-ink"
            }`}
          />
        ) : inlineScenario ? (
          <select
            aria-label={`Comparison scenario for ${page.title}`}
            value={inlineScenarioValue}
            onChange={(e) =>
              props.onOptionsChange(
                inlineScenario.set(props.options as never, e.target.value),
              )
            }
            className={`w-[13rem] rounded border bg-paper px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              inlineScenarioValue
                ? "border-accent text-accent"
                : "border-hair text-ink-3 hover:border-hair-2 hover:text-ink"
            }`}
          >
            <option value="">{inlineScenario.placeholder}</option>
            {comparisonScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <div
            title="This page always uses the base plan"
            className="w-[13rem] cursor-not-allowed select-none rounded border border-hair bg-paper/50 px-2 py-1 text-xs text-ink-4"
          >
            Base plan
          </div>
        )}
        <button
          type="button"
          aria-label={`Remove ${page.title}`}
          className="rounded p-1 text-ink-4 transition-colors hover:bg-card-hover hover:text-crit"
          onClick={props.onRemove}
        >
          ✕
        </button>
      </div>
      {Options && (
        <DialogShell
          open={showOptions}
          onOpenChange={setShowOptions}
          title={`${page.title} options`}
          size="md"
          primaryAction={{ label: "Done", onClick: () => setShowOptions(false) }}
        >
          <Options
            value={props.options as never}
            onChange={(v) => props.onOptionsChange(v)}
          />
        </DialogShell>
      )}
    </div>
  );
}
