"use client";

import { useState } from "react";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { ScenarioPickerDropdown } from "@/components/scenario/scenario-picker-dropdown";

interface Props {
  index: number;
  pageId: PresentationPageId;
  options: unknown;
  scenarioOverride: string | null | undefined;
  onOptionsChange: (next: unknown) => void;
  onScenarioOverrideChange: (next: string | null | undefined) => void;
  onRemove: () => void;
  onPreview: () => void;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function SelectedPageRow(props: Props) {
  const page = PRESENTATION_PAGES[props.pageId];
  const [showOptions, setShowOptions] = useState(false);
  const [showScenario, setShowScenario] = useState(false);
  const summary = page.summarizeOptions(props.options as never);
  const Options = page.OptionsControl;

  const scenarioLabel =
    props.scenarioOverride === undefined
      ? "Default scenario"
      : props.scenarioOverride === null
        ? "Base case"
        : (props.scenarios.find((s) => s.id === props.scenarioOverride)?.name ??
          props.scenarioOverride);

  const hasOverride = props.scenarioOverride !== undefined;

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
        {Options && (
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs transition-colors ${
              showOptions
                ? "bg-card-hover text-ink"
                : "text-ink-3 hover:bg-card-hover hover:text-ink"
            }`}
            onClick={() => setShowOptions((v) => !v)}
          >
            Options
          </button>
        )}
        {page.supportsScenarioOverride && (
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs transition-colors ${
              hasOverride
                ? "text-accent hover:bg-card-hover"
                : "text-ink-3 hover:bg-card-hover hover:text-ink"
            }`}
            onClick={() => setShowScenario((v) => !v)}
          >
            {scenarioLabel}
          </button>
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
      {showOptions && Options && (
        <div className="border-t border-hair pt-2">
          <Options
            value={props.options as never}
            onChange={(v) => props.onOptionsChange(v)}
          />
        </div>
      )}
      {showScenario && page.supportsScenarioOverride && (
        <div className="border-t border-hair pt-2 space-y-2">
          <ScenarioPickerDropdown
            value={
              props.scenarioOverride === undefined
                ? "base"
                : (props.scenarioOverride ?? "base")
            }
            onChange={(v) => props.onScenarioOverrideChange(v)}
            scenarios={props.scenarios}
            snapshots={props.snapshots}
            ariaLabel={`Scenario override for ${page.title}`}
          />
          <button
            type="button"
            className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => props.onScenarioOverrideChange(undefined)}
          >
            Use default scenario
          </button>
        </div>
      )}
    </div>
  );
}
