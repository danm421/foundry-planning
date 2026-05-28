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
        : props.scenarioOverride;

  return (
    <div className="rounded border bg-white p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="cursor-grab text-gray-400 select-none" aria-hidden>
          ⠿
        </span>
        <div className="flex-1">
          <div className="font-medium text-sm">{page.title}</div>
          <div className="text-xs text-gray-500">{summary}</div>
        </div>
        <button
          type="button"
          className="text-xs underline text-gray-600"
          onClick={() => setShowOptions((v) => !v)}
        >
          Options
        </button>
        <button
          type="button"
          className="text-xs underline text-gray-600"
          onClick={() => setShowScenario((v) => !v)}
        >
          {scenarioLabel}
        </button>
        <button
          type="button"
          aria-label={`Remove ${page.title}`}
          className="text-gray-400 hover:text-red-600"
          onClick={props.onRemove}
        >
          ✕
        </button>
      </div>
      {showOptions && (
        <div className="border-t pt-2">
          <Options
            value={props.options as never}
            onChange={(v) => props.onOptionsChange(v)}
          />
        </div>
      )}
      {showScenario && (
        <div className="border-t pt-2 space-y-2">
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
            className="text-xs underline text-gray-600"
            onClick={() => props.onScenarioOverrideChange(undefined)}
          >
            Use default scenario
          </button>
        </div>
      )}
    </div>
  );
}
